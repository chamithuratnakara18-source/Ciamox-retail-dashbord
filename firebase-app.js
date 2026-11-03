import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import { firebaseConfig } from './firebase-config.js';

export const firebaseApp = getApps()[0] || initializeApp(firebaseConfig);
