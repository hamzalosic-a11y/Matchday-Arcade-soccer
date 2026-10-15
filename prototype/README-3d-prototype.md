3D prototype for Matchday - Arcade Soccer

Files in prototype/:

- 3d-prototype.html

What this is
- A standalone test HTML page (prototype/3d-prototype.html) that demonstrates loading a glTF model (CesiumMan sample) and placing multiple player models on a pitch using three.js. It is intentionally standalone so you can open it without touching index.html.

How to test locally
1. Clone the repo and checkout the feature/3d-prototype branch.
2. Start a simple static HTTP server from the repository root (this avoids CORS problems when loading the GLB):
   - Python 3: `python -m http.server 8000`
   - Node: `npx http-server -p 8000`
3. Open http://localhost:8000/prototype/3d-prototype.html in a desktop browser.

Notes & next steps
- This prototype uses a public sample GLB hosted in the KhronosGroup glTF-Sample-Models repo. Replace the SAMPLE URL in the HTML with your own glb URL (or add a model under prototype/assets/) to test realistic player models with animations.
- Integration with the main game:
  - The main game's simulation is in index.html and manages players[] and cam. The next step is to add a three.js renderer that reads that players[] array and updates the 3D instances' positions/rotations each frame — I can add that integration to the branch when you confirm.
- Performance: replace copies of animated skinned meshes with an instancing or GPU-skinned approach for many players on low-end devices.

If you want, I can now:
- Replace the sample model with a different public glb you prefer.
- Add an integration script that reads the real players[] from index.html and drives the three.js scene (this requires modifying index.html and I will commit those changes on the feature/3d-prototype branch).

