let audioContext;
let source;
let processor;
let silentGain;
let stream;
let pcm = [];
let running = false;
let worker;
const SAMPLE_RATE = 16000;
const WINDOW_SECONDS = 2;
const MIN_RMS = 0.012;
const MIN_PEAK = 0.035;

function getWorker() {
  if (worker) return worker;
  worker = new Worker('whisper-worker.js');
  worker.onmessage = (event) => {
    if (event.data.type === 'TEXT') send({ type: 'TRANSCRIPT', text: event.data.text });
    if (event.data.type === 'STATUS') send({ type: 'MODEL_STATUS', text: event.data.text });
    if (event.data.type === 'PROGRESS') send({ type: 'MODEL_STATUS', text: `正在下载本地模型… ${event.data.value}%` });
    if (event.data.type === 'ERROR') send({ type: 'CAPTURE_ERROR', error: event.data.error });
  };
  return worker;
}

async function send(message) { try { await chrome.runtime.sendMessage(message); } catch (error) { /* side panel may be closed */ } }
function downsample(input, inputRate) { if (inputRate === SAMPLE_RATE) return input; const ratio = inputRate / SAMPLE_RATE; const length = Math.round(input.length / ratio); const output = new Float32Array(length); for (let i = 0; i < length; i += 1) output[i] = input[Math.min(input.length - 1, Math.floor(i * ratio))]; return output; }
function audioStats(data) {
  let sum = 0;
  let peak = 0;
  for (const value of data) { sum += value * value; peak = Math.max(peak, Math.abs(value)); }
  return { rms: Math.sqrt(sum / data.length), peak };
}
async function processWindow(data) {
  const { rms, peak } = audioStats(data);
  // Do not wake Whisper for silence, room noise, or a nearly muted tab.
  if (rms < MIN_RMS || peak < MIN_PEAK) return;
  getWorker().postMessage({ type: 'TRANSCRIBE', audio: data }, [data.buffer]);
}
async function stop({ notify = true } = {}) {
  running = false;
  pcm = [];
  processor?.disconnect();
  source?.disconnect();
  silentGain?.disconnect();
  processor = null;
  source = null;
  silentGain = null;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  if (audioContext && audioContext.state !== 'closed') {
    try { await audioContext.close(); } catch (error) { /* context may have closed during teardown */ }
  }
  audioContext = null;
  if (notify) send({ type: 'CAPTURE_STATE', state: 'paused' });
}
async function start(streamId) {
  await stop({ notify: false });
  stream = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }, video: false });
  audioContext = new AudioContext();
  if (audioContext.state === 'suspended') await audioContext.resume();
  source = audioContext.createMediaStreamSource(stream);
  processor = audioContext.createScriptProcessor(4096, 1, 1);
  silentGain = audioContext.createGain();
  silentGain.gain.value = 0;
  processor.onaudioprocess = (event) => { if (!running) return; const chunk = downsample(event.inputBuffer.getChannelData(0), audioContext.sampleRate); pcm.push(chunk); const length = pcm.reduce((sum, item) => sum + item.length, 0); if (length >= SAMPLE_RATE * WINDOW_SECONDS) { const window = new Float32Array(length); let offset = 0; for (const part of pcm) { window.set(part, offset); offset += part.length; } pcm = []; processWindow(window); } };
  // tabCapture removes the tab's normal audible output. Route the original
  // stream back to the destination so the user can keep hearing the video.
  source.connect(audioContext.destination);
  source.connect(processor);
  processor.connect(silentGain);
  silentGain.connect(audioContext.destination);
  running = true;
  send({ type: 'CAPTURE_STATE', state: 'capturing' });
  send({ type: 'MODEL_STATUS', text: '已捕获当前标签页音频；声音会继续从扬声器播放。' });
}
chrome.runtime.onMessage.addListener((message) => { if (message.type === 'START_TAB_CAPTURE') start(message.streamId).catch((error) => send({ type: 'CAPTURE_ERROR', error: error.message })); if (message.type === 'STOP_TAB_CAPTURE') stop(); });
