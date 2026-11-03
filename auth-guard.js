import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import { firebaseApp } from './firebase-app.js';

export const auth = getAuth(firebaseApp);
export const RETAIL_ROLES = Object.freeze(['owner', 'admin', 'manager', 'cashier']);
let resolveAuthReady;
const authReady = new Promise(resolve => { resolveAuthReady = resolve; });
const stopInitialAuthObserver = onAuthStateChanged(auth, user => resolveAuthReady(user), () => resolveAuthReady(null));
void authReady.then(() => stopInitialAuthObserver());

export async function requireRetailUser() {
  await authReady;
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to continue.');
  const token = await user.getIdTokenResult();
  if (!RETAIL_ROLES.includes(token.claims.retailRole)) {
    throw new Error('This account has not been granted access to RetailFlow.');
  }
  return user;
}

export { onAuthStateChanged, signInWithEmailAndPassword, signOut };
