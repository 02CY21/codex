const refs = { toggle: document.querySelector('#toggle'), toggleIcon: document.querySelector('#toggleIcon'), toggleText: document.querySelector('#toggleText'), clear: document.querySelector('#clear'), settings: document.querySelector('#settings'), transcript: document.querySelector('#transcript'), counter: document.querySelector('#counter'), dot: document.querySelector('#stateDot'), modelStatus: document.querySelector('#modelStatus') };
let records = [];
let translator;
const DEFAULT_MODEL = 'doubao-seed-2.1-lite';
const TRANSLATION_SYSTEM_PROMPT = '你是一个专业的视频字幕翻译。把下面的英文翻译成自然流畅的简体中文，口语化，符合中文表达习惯，不要逐字硬翻，直接输出翻译结果，不要加任何解释。';

function escape(value) { return String(value).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]); }
function render() {
  refs.counter.textContent = `${records.length} RECORDS`;
  refs.transcript.innerHTML = records.length ? records.map((item) => `<article class="record"><time>${escape(item.time)}</time><div class="en">${escape(item.en)}</div><div class="zh ${item.pending ? 'pending' : ''}">${escape(item.zh)}</div></article>`).join('') : '<div class="empty"><span>◌</span><strong>等待标签页音频</strong><p>先播放英语内容，再点击上方按钮开始。</p></div>';
  refs.transcript.scrollTop = refs.transcript.scrollHeight;
}
function setState(capturing) { refs.dot.classList.toggle('live', capturing); refs.toggle.classList.toggle('live', capturing); refs.toggleIcon.textContent = capturing ? 'Ⅱ' : '▶'; refs.toggleText.textContent = capturing ? '暂停捕获' : '开始捕获当前标签页'; }
function addRecord(en, zh = '正在翻译…', pending = true) { const item = { time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), en, zh, pending }; records.push(item); render(); return item; }

async function translate(text, onPartial = () => {}) {
  const config = await chrome.storage.local.get({ doubaoApiUrl: '', doubaoApiKey: '', doubaoModel: DEFAULT_MODEL });
  if (config.doubaoModel === 'doubao-1-5-lite-32k') config.doubaoModel = DEFAULT_MODEL;
  if (config.doubaoApiUrl?.trim() && config.doubaoApiKey?.trim()) {
    try {
      const response = await fetch(config.doubaoApiUrl.trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.doubaoApiKey.trim()}` },
        body: JSON.stringify({
          model: config.doubaoModel?.trim() || DEFAULT_MODEL,
          temperature: 0.2,
          stream: true,
          messages: [
            { role: 'system', content: TRANSLATION_SYSTEM_PROMPT },
            { role: 'user', content: `英文句子：${text}` }
          ]
        })
      });
      if (!response.ok) throw new Error(`翻译 API ${response.status}`);
      if (!response.body) throw new Error('翻译 API 未返回流式响应');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let result = '';
      let done = false;
      while (!done) {
        const packet = await reader.read();
        done = packet.done;
        buffer += decoder.decode(packet.value || new Uint8Array(), { stream: !done });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          const data = JSON.parse(payload);
          const delta = data.choices?.[0]?.delta?.content || data.choices?.[0]?.message?.content || '';
          if (delta) { result += delta; onPartial(simplify(result)); }
        }
      }
      if (!result.trim()) throw new Error('翻译 API 未返回翻译内容');
      return simplify(result.trim());
    } catch (error) {
      console.warn('Doubao translation failed', error);
      return `豆包翻译失败：${error.message} · ${localFallback(text)}`;
    }
  }
  if ('Translator' in self) {
    try {
      if (!translator) {
        const availability = await Translator.availability({ sourceLanguage: 'en', targetLanguage: 'zh' });
        if (availability !== 'unavailable') translator = await Translator.create({ sourceLanguage: 'en', targetLanguage: 'zh' });
      }
      if (translator) return simplify(await translator.translate(text));
    } catch (error) { /* use the local fallback below */ }
  }
  return localFallback(text);
}

function localFallback(text) {
  const words = { hello:'你好', thanks:'谢谢', thank:'感谢', welcome:'欢迎', this:'这', is:'是', a:'一个', the:'这', video:'视频', audio:'音频', translation:'翻译', window:'窗口', please:'请', wait:'稍等', and:'和', you:'你', are:'是', we:'我们', can:'可以', see:'看见', now:'现在' };
  const output = text.toLowerCase().replace(/[a-z]+/g, (word) => words[word] || word);
  return /[\u3400-\u9fff]/.test(output) ? simplify(`本地近似译文：${output}`) : `浏览器未提供中文翻译模型：${text}`;
}

function simplify(text) {
  const traditional = { 國:'国', 語:'语', 說:'说', 話:'话', 這:'这', 個:'个', 會:'会', 學:'学', 習:'习', 開:'开', 關:'关', 間:'间', 時:'时', 後:'后', 發:'发', 現:'现', 覺:'觉', 點:'点', 給:'给', 讓:'让', 買:'买', 賣:'卖', 聽:'听', 見:'见', 認:'认', 識:'识', 讀:'读', 寫:'写', 變:'变', 體:'体', 簡:'简', 錄:'录', 頁:'页', 翻:'翻', 譯:'译', 這個:'这个' };
  return String(text).replace(/[國語說話這個會學習開關間時後發現覺點給讓買賣聽見認識讀寫變體簡錄頁翻譯]/g, (char) => traditional[char] || char);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'TRANSCRIPT') {
    if (!message.text || /(.)\1{4,}/u.test(message.text.replace(/\s+/g, ''))) return;
    const normalized = message.text.trim();
    if (records.at(-1)?.en.toLowerCase() === normalized.toLowerCase()) return;
    const item = addRecord(normalized);
    // Each transcript starts its own request immediately; there is no translation queue.
    translate(normalized, (partial) => { item.zh = partial; render(); }).then((zh) => { item.zh = zh; item.pending = false; render(); });
  }
  if (message.type === 'MODEL_STATUS') refs.modelStatus.textContent = message.text;
  if (message.type === 'CAPTURE_STATE') setState(message.state === 'capturing');
  if (message.type === 'CAPTURE_ERROR') refs.modelStatus.textContent = `捕获失败：${message.error}`;
});

refs.toggle.addEventListener('click', async () => {
  refs.modelStatus.innerHTML = '<span class="spinner"></span>正在启动标签页音频捕获与本地识别…';
  const result = await chrome.runtime.sendMessage({ type: 'TOGGLE_CAPTURE_FROM_PANEL' });
  if (!result?.ok) {
    const detail = result?.error || '未知错误';
    refs.modelStatus.textContent = detail.includes('not been invoked')
      ? '请先在正在播放视频的标签页点击浏览器工具栏里的 SubSync 图标，再重试。'
      : `无法启动：${detail}`;
  }
});
refs.clear.addEventListener('click', () => { records = []; render(); });
refs.settings.addEventListener('click', () => chrome.runtime.openOptionsPage());
chrome.storage.local.get(['captureState']).then(({ captureState }) => setState(captureState === 'capturing'));
render();
