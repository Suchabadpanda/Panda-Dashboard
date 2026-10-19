'use strict';
(async function () {
  const $ = (id) => document.getElementById(id);
  const s = await window.panda.getSettings();
  $('url').value = s.url || ''; $('away').value = s.awayUrl || '';
  $('hide').checked = s.hideDashOnBlur; $('start').checked = s.startWithWindows; $('size').value = s.dashSize;
  if (s.hasToken) $('token').placeholder = 'Saved. Paste a new token to replace it';
  $('version').textContent = `Version ${s.version}`;

  async function showStatus() {
    const st = await window.panda.status();
    const el = $('status');
    if (st.ready) {
      el.className = 'status ok';
      el.textContent = `Connected to ${st.url}. Using ${st.personal ? 'your Panda Dashboard settings' : 'the example settings (no config.js of your own yet)'}; tariffs from ${st.tariffs === 'dashboard' ? 'the dashboard' : 'config.js'}.`;
    } else {
      el.className = `status ${st.status === 'auth-failed' ? 'bad' : ''}`;
      el.textContent = st.error || (st.status === 'connecting' ? 'Connecting…' : 'Not connected yet.');
    }
  }

  $('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('save').disabled = true; $('status').className = 'status'; $('status').textContent = 'Connecting…';
    try {
      await window.panda.saveSettings({ url: $('url').value, awayUrl: $('away').value, token: $('token').value, hideDashOnBlur: $('hide').checked, startWithWindows: $('start').checked, dashSize: $('size').value });
      $('token').value = ''; $('token').placeholder = 'Saved. Paste a new token to replace it';
    } catch (e) { $('status').className = 'status bad'; $('status').textContent = e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
    $('save').disabled = false;
  });
  $('close').addEventListener('click', () => window.close());
  $('token-page').addEventListener('click', () => window.panda.openTokenPage());

  showStatus(); setInterval(showStatus, 1500);
})();
