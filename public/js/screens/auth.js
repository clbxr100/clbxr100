// Sign in / sign up / guest screen.
import { api } from '../api.js';
import { $, signedIn, toast } from '../app.js';

let mode = 'login';

export function initAuth() {
  const tabs = document.querySelectorAll('#auth-tabs .tab');
  const username = $('#auth-username');
  const password = $('#auth-password');
  const submit = $('#auth-submit');
  const note = $('#auth-note');

  const labels = { login: 'Sign In', signup: 'Create Account', guest: 'Play as Guest' };
  const notes = {
    login: '',
    signup: '3–16 letters, numbers or underscores',
    guest: 'No password — progress saved on this device for 7 days',
  };

  tabs.forEach(tab => tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.toggle('active', t === tab));
    mode = tab.dataset.tab;
    password.classList.toggle('hidden', mode === 'guest');
    username.placeholder = mode === 'guest' ? 'Nickname' : 'Username';
    password.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    submit.textContent = labels[mode];
    note.textContent = notes[mode];
  }));

  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    submit.innerHTML = '<span class="spin">🂠</span>';
    try {
      let res;
      if (mode === 'guest') {
        res = await api.post('/api/auth/guest', { name: username.value.trim() });
      } else {
        res = await api.post(`/api/auth/${mode}`, {
          username: username.value.trim(),
          password: password.value,
        });
      }
      signedIn(res.token, res.profile);
      password.value = '';
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      submit.disabled = false;
      submit.textContent = labels[mode];
    }
  });
}
