RetailFlow full flat ZIP (no subfolders inside)

1. Extract this ZIP into a new folder on your PC. Do not upload the ZIP itself to GitHub.
2. In GitHub Desktop, clone/open Ciamox-retail-dashbord and select AI-product-detection-cam.
3. Right-click Install-RetailFlow.ps1 and choose Run with PowerShell. If Windows blocks it, open PowerShell in the extracted folder and run:
   powershell -ExecutionPolicy Bypass -File .\Install-RetailFlow.ps1 -RepositoryPath "C:\path\to\Ciamox-retail-dashbord"
4. The installer copies every file into the local repository and creates api/ and lib/ automatically. It stops if the selected branch is wrong.
5. In GitHub Desktop, confirm api/ultralytics/sync.js and lib/ultralytics-sync.js in the changed-file list, Commit, and Push origin. Open a PR to main and deploy Production.

Vercel cannot deploy nested API routes without the api/ paths in the Git repository. This flat download is a transport package; the installer creates the required paths locally.
