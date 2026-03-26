/**
 * 即時語音對話 — 前端
 * 單一 WebSocket：語音進（上傳） / 語音出（播放）
 */

(function () {
  const wsUrlEl = document.getElementById('wsUrl');
  const btnConnect = document.getElementById('btnConnect');
  const btnDisconnect = document.getElementById('btnDisconnect');
  const btnMic = document.getElementById('btnMic');
  const btnSendText = document.getElementById('btnSendText');
  const connectionStatus = document.getElementById('connectionStatus');
  const micStatus = document.getElementById('micStatus');
  const transcriptBox = document.getElementById('transcriptBox');

  let ws = null;
  let mediaStream = null;
  let audioContext = null;
  let processor = null;
  let source = null;
  let isMicActive = false;
  let playbackQueue = [];
  let isPlaying = false;

  // ---------- WebSocket ----------
  function connect() {
    const url = wsUrlEl.value.trim();
    if (!url) return;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      setConnectionStatus('連線失敗: ' + e.message, true);
      return;
    }

    setConnectionStatus('連線中…', false);
    btnConnect.disabled = true;

    ws.onopen = function () {
      setConnectionStatus('已連線', false, true);
      btnConnect.disabled = true;
      btnDisconnect.disabled = false;
      btnMic.disabled = false;
      btnSendText.disabled = false;
      addTranscript('system', 'WebSocket 已連線');
    };

    ws.onmessage = function (ev) {
      if (typeof ev.data === 'string') {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'audio' && msg.data) {
            playAudioChunk(msg.data);
          } else if (msg.type === 'transcript' && msg.text) {
            addTranscript('assistant', msg.text);
          } else if (msg.type === 'error') {
            addTranscript('system', '錯誤: ' + (msg.message || '未知'));
          }
        } catch (_) {
          addTranscript('system', ev.data);
        }
      } else if (ev.data instanceof Blob) {
        const reader = new FileReader();
        reader.onload = function () {
          const b64 = arrayBufferToBase64(reader.result);
          playAudioChunk(b64);
        };
        reader.readAsDataURL(ev.data);
      }
    };

    ws.onclose = function () {
      setConnectionStatus('已斷線', false);
      btnConnect.disabled = false;
      btnDisconnect.disabled = true;
      btnMic.disabled = true;
      btnSendText.disabled = true;
      stopMic();
      addTranscript('system', 'WebSocket 已斷線');
    };

    ws.onerror = function () {
      setConnectionStatus('WebSocket 錯誤', true);
    };
  }

  function disconnect() {
    if (ws) {
      ws.close();
      ws = null;
    }
  }

  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(typeof data === 'string' ? data : JSON.stringify(data));
    }
  }

  // ---------- 狀態與轉寫 ----------
  function setConnectionStatus(text, isError, isOk) {
    connectionStatus.textContent = text;
    connectionStatus.classList.toggle('error', !!isError);
    connectionStatus.classList.toggle('connected', !!isOk);
  }

  function addTranscript(role, text) {
    const line = document.createElement('div');
    line.className = 'line ' + role;
    line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + text;
    transcriptBox.appendChild(line);
    transcriptBox.scrollTop = transcriptBox.scrollHeight;
  }

  // ---------- 麥克風採集（PCM 片段 → base64 上傳） ----------
  function startMic() {
    if (mediaStream || isMicActive) return;
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(function (stream) {
        mediaStream = stream;
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const input = audioContext.createMediaStreamSource(stream);

        const bufferSize = 4096;
        processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
        processor.onaudioprocess = function (e) {
          if (!isMicActive || !ws || ws.readyState !== WebSocket.OPEN) return;
          const inputData = e.inputBuffer.getChannelData(0);
          const pcm = floatTo16BitPCM(inputData);
          send({ type: 'audio', data: arrayBufferToBase64(pcm) });
        };

        input.connect(processor);
        processor.connect(audioContext.destination);
        source = input;
        isMicActive = true;
        btnMic.classList.add('active');
        btnMic.textContent = '🔴 錄音中（點擊停止）';
        micStatus.textContent = '正在錄音並上傳…';
      })
      .catch(function (err) {
        micStatus.textContent = '麥克風錯誤: ' + err.message;
        addTranscript('system', '麥克風錯誤: ' + err.message);
      });
  }

  function stopMic() {
    isMicActive = false;
    if (processor && source) {
      try {
        source.disconnect();
        processor.disconnect();
      } catch (_) {}
      processor = null;
      source = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach(function (t) {
        t.stop();
      });
      mediaStream = null;
    }
    if (audioContext) {
      audioContext.close().catch(function () {});
      audioContext = null;
    }
    btnMic.classList.remove('active');
    btnMic.textContent = '🎤 麥克風';
    micStatus.textContent = '請先連線';
  }

  function floatTo16BitPCM(float32Array) {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  // ---------- 播放（base64 音頻片段） ----------
  function playAudioChunk(base64Data) {
    try {
      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      playbackQueue.push(bytes.buffer);
      drainPlaybackQueue();
    } catch (e) {
      console.warn('playAudioChunk decode error', e);
    }
  }

  function drainPlaybackQueue() {
    if (isPlaying || playbackQueue.length === 0) return;
    isPlaying = true;
    const chunk = playbackQueue.shift();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    ctx.decodeAudioData(chunk.slice(0))
      .then(function (buffer) {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.onended = function () {
          isPlaying = false;
          drainPlaybackQueue();
        };
        source.start(0);
      })
      .catch(function () {
        isPlaying = false;
        drainPlaybackQueue();
      });
  }

  // ---------- 文字發送（測試用，不需 ASR） ----------
  function sendText() {
    const text = window.prompt('輸入要發送的文字（會觸發 AI 語音回覆）:', '你好');
    if (text == null || !text.trim()) return;
    addTranscript('user', text.trim());
    send({ type: 'text', text: text.trim() });
    micStatus.textContent = '已發送文字，等待語音回覆…';
  }

  // ---------- 按鈕事件 ----------
  btnConnect.addEventListener('click', connect);
  btnDisconnect.addEventListener('click', disconnect);
  btnMic.addEventListener('click', function () {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (isMicActive) stopMic();
    else startMic();
  });
  btnSendText.addEventListener('click', sendText);
})();
