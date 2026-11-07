const DEFAULT_MODEL = 'doubao-seed-2.1-lite';
const refs = { form: document.querySelector('#form'), apiUrl: document.querySelector('#apiUrl'), apiKey: document.querySelector('#apiKey'), model: document.querySelector('#model'), showKey: document.querySelector('#showKey'), status: document.querySelector('#status') };

async function load() {
  const values = await chrome.storage.local.get({ doubaoApiUrl: '', doubaoApiKey: '', doubaoModel: DEFAULT_MODEL });
  refs.apiUrl.value = values.doubaoApiUrl || '';
  refs.apiKey.value = values.doubaoApiKey || '';
  refs.model.value = values.doubaoModel === 'doubao-1-5-lite-32k' ? DEFAULT_MODEL : (values.doubaoModel || DEFAULT_MODEL);
}

refs.showKey.addEventListener('click', () => {
  const visible = refs.apiKey.type === 'text';
  refs.apiKey.type = visible ? 'password' : 'text';
  refs.showKey.textContent = visible ? '显示' : '隐藏';
});

refs.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const apiUrl = refs.apiUrl.value.trim();
  const apiKey = refs.apiKey.value.trim();
  const model = refs.model.value.trim() || DEFAULT_MODEL;
  if (apiUrl) {
    let url;
    try { url = new URL(apiUrl); } catch (error) { refs.status.className = 'status error'; refs.status.textContent = 'API 地址格式不正确。'; return; }
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname) { refs.status.className = 'status error'; refs.status.textContent = 'API 地址必须使用 http 或 https。'; return; }
    try {
      const granted = await chrome.permissions.request({ origins: [`${url.origin}/*`] });
      if (!granted) { refs.status.className = 'status error'; refs.status.textContent = '未获得该 API 域名访问权限，未保存地址。'; return; }
    } catch (error) { refs.status.className = 'status error'; refs.status.textContent = `域名权限申请失败：${error.message}`; return; }
  }
  await chrome.storage.local.set({ doubaoApiUrl: apiUrl, doubaoApiKey: apiKey, doubaoModel: model });
  refs.status.className = 'status';
  refs.status.textContent = apiUrl && apiKey ? '已保存。下一条字幕将使用该 API 翻译。' : '已保存；API 地址和 Key 未完整填写时将使用本地兜底翻译。';
});

load();
