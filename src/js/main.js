import { start } from './app.js';

try {
  start();
} catch (e) {
  // Something is badly wrong (for example the phone's storage is corrupted). Say so plainly.
  const box = document.getElementById('screen');
  box.textContent = '';
  const div = document.createElement('div');
  div.className = 'fatal';
  div.textContent = 'The app could not start. Close it and open it again. If this keeps happening, tell the person who set it up: ' + (e && e.message ? e.message : e);
  box.append(div);
}
