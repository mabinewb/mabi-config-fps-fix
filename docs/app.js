const DEFAULT_EXPORT_PATH = '문서\\마비노기\\설정\\목록';

const state = {
  file: null,
  logLines: ['준비되었습니다.'],
};

const refs = {};

document.addEventListener('DOMContentLoaded', () => {
  refs.fileInput = document.getElementById('fileInput');
  refs.dropZone = document.getElementById('dropZone');
  refs.selectedFile = document.getElementById('selectedFile');
  refs.currentFps = document.getElementById('currentFps');
  refs.processButton = document.getElementById('processButton');
  refs.clearButton = document.getElementById('clearButton');
  refs.copyLogButton = document.getElementById('copyLogButton');
  refs.copyPathButton = document.getElementById('copyPathButton');
  refs.resultBox = document.getElementById('resultBox');
  refs.logOutput = document.getElementById('logOutput');

  refs.fileInput.addEventListener('change', async (event) => {
    const [file] = event.target.files || [];
    await setSelectedFile(file || null);
  });

  refs.processButton.addEventListener('click', async () => {
    if (state.file) {
      await processFile(state.file);
    }
  });

  refs.clearButton.addEventListener('click', clearSelection);
  refs.copyLogButton.addEventListener('click', copyLog);
  refs.copyPathButton.addEventListener('click', copyDefaultPath);

  ['dragenter', 'dragover'].forEach((eventName) => {
    refs.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      refs.dropZone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    refs.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      refs.dropZone.classList.remove('dragover');
    });
  });

  refs.dropZone.addEventListener('drop', async (event) => {
    const [file] = event.dataTransfer?.files || [];
    await setSelectedFile(file || null);
  });

  renderLog();
});

async function setSelectedFile(file) {
  state.file = file;
  refs.fileInput.value = '';
  refs.processButton.disabled = !file;
  refs.clearButton.disabled = !file;

  if (!file) {
    refs.selectedFile.textContent = '없음';
    refs.currentFps.textContent = '-';
    setResult('neutral', '파일을 선택하시면 이곳에 처리 결과를 안내해 드립니다.');
    appendLog('파일 선택을 해제했습니다.');
    return;
  }

  refs.selectedFile.textContent = `${file.name} (${formatFileSize(file.size)})`;
  refs.currentFps.textContent = '확인 전';
  setResult('neutral', '내보낸 설정 파일을 확인하고 있습니다.');
  appendLog(`파일을 선택했습니다: ${file.name}`);

  try {
    const { currentFps } = await inspectSelectedFile(file);
    refs.currentFps.textContent = currentFps;
    refs.processButton.disabled = currentFps === '-1';

    if (currentFps === '-1') {
      setResult('warning', '현재 FPS 값이 이미 -1이므로 수정할 필요가 없습니다.');
      appendLog('현재 FPS 값이 이미 -1입니다.');
      return;
    }

    setResult('neutral', `현재 FPS 값은 ${currentFps}입니다.\n버튼을 누르면 가져오기용 .muo 파일을 만듭니다.`);
    appendLog(`현재 FPS 값을 확인했습니다: ${currentFps}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    refs.currentFps.textContent = '확인 실패';
    refs.processButton.disabled = true;
    setResult('error', `선택한 파일을 확인하지 못했습니다: ${message}`);
    appendLog(`선택 파일 확인 실패: ${message}`);
  }
}

function clearSelection() {
  state.file = null;
  refs.fileInput.value = '';
  refs.selectedFile.textContent = '없음';
  refs.currentFps.textContent = '-';
  refs.processButton.disabled = true;
  refs.clearButton.disabled = true;
  setResult('neutral', '파일을 선택하시면 이곳에 처리 결과를 안내해 드립니다.');
  appendLog('선택을 초기화했습니다.');
}

async function processFile(file) {
  try {
    appendLog(`수정을 시작했습니다: ${file.name}`);
    const { currentFps, xmlText } = await inspectSelectedFile(file);
    refs.currentFps.textContent = currentFps;

    if (currentFps === '-1') {
      setResult('warning', '이미 FPS가 -1로 설정되어 있어 다운로드하지 않았습니다.');
      appendLog('이미 -1 상태여서 다운로드를 생략했습니다.');
      return;
    }

    const patchedText = patchFps(xmlText);
    const outputBytes = encodeMuo(patchedText);
    const outputName = makeOutputName(file.name);

    downloadBytes(outputBytes, outputName);
    refs.currentFps.textContent = '-1';
    refs.processButton.disabled = true;
    setResult(
      'success',
      `설정 수정이 완료되었습니다.\n${outputName} 파일을 "${DEFAULT_EXPORT_PATH}" 폴더로 이동하세요.\n그다음 게임의 "환경설정 → 환경설정 관리"에서 가져오기 버튼을 누르고 "환경설정"만 체크하여 가져오세요.`,
    );
    appendLog(`가져오기용 파일 다운로드를 준비했습니다: ${outputName}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setResult('error', `실패: ${message}`);
    appendLog(`오류: ${message}`);
  }
}

async function inspectSelectedFile(file) {
  if (!file.name.toLowerCase().endsWith('.muo')) {
    throw new Error('.muo 확장자의 설정 내보내기 파일만 지원합니다.');
  }

  const encodedBytes = new Uint8Array(await file.arrayBuffer());
  const xmlText = decodeMuo(encodedBytes);
  const currentFps = extractCurrentFps(xmlText);

  if (currentFps === null) {
    throw new Error(
      'DummyCharRenderModeFPS 설정을 찾을 수 없습니다. 게임에서 내보낼 때 "환경설정" 항목을 체크했는지 확인해 주세요.',
    );
  }

  return { currentFps, xmlText };
}

function decodeMuo(bytes) {
  if (bytes.length < 8) {
    throw new Error('파일이 너무 짧아 .muo 헤더를 읽을 수 없습니다.');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const storedCrc = view.getUint32(0, true);
  const characterCount = view.getInt32(4, true);

  if (characterCount < 0 || bytes.length !== 8 + characterCount * 2) {
    throw new Error('.muo 본문 길이가 헤더 정보와 일치하지 않습니다.');
  }

  const payloadBytes = bytes.subarray(8);
  const crcInput = concatBytes(payloadBytes, new Uint8Array(2));
  if (crc32(crcInput) !== storedCrc) {
    throw new Error('CRC32 검증에 실패했습니다. 파일이 손상되었을 수 있습니다.');
  }

  const payload = decodeUtf16Le(payloadBytes);
  const separatorIndex = payload.indexOf(';');
  if (separatorIndex <= 0) {
    throw new Error('.muo 압축 정보가 올바르지 않습니다.');
  }

  const expectedSizeText = payload.slice(0, separatorIndex);
  if (!/^\d+$/.test(expectedSizeText)) {
    throw new Error('.muo 원본 크기 정보를 해석할 수 없습니다.');
  }

  const expectedSize = Number.parseInt(expectedSizeText, 10);
  const compressedHex = payload.slice(separatorIndex + 1);
  if (compressedHex.length === 0 || compressedHex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(compressedHex)) {
    throw new Error('.muo 압축 데이터가 올바른 소문자 16진수 형식이 아닙니다.');
  }

  let xmlBytes;
  try {
    xmlBytes = new Uint8Array(window.pako.inflate(hexToBytes(compressedHex)));
  } catch {
    throw new Error('.muo 내부 XML 압축을 해제하지 못했습니다.');
  }

  if (xmlBytes.length !== expectedSize) {
    throw new Error(`압축 해제 크기가 일치하지 않습니다. 예상 ${expectedSize}바이트, 실제 ${xmlBytes.length}바이트입니다.`);
  }
  if (xmlBytes.length < 2 || xmlBytes.at(-2) !== 0 || xmlBytes.at(-1) !== 0) {
    throw new Error('.muo 내부 XML에 UTF-16 종료 문자가 없습니다.');
  }

  const xmlText = decodeUtf16Le(xmlBytes.subarray(0, -2)).replace(/^\uFEFF/, '');
  validateMuoXml(xmlText);
  return xmlText;
}

function encodeMuo(xmlText) {
  validateMuoXml(xmlText);

  const xmlBytes = encodeUtf16Le(xmlText + '\x00');
  const compressedBytes = new Uint8Array(window.pako.deflate(xmlBytes, { level: 6 }));
  const payload = `${xmlBytes.length};${bytesToHex(compressedBytes)}`;
  const payloadBytes = encodeUtf16Le(payload);
  const output = new Uint8Array(8 + payloadBytes.length);
  const view = new DataView(output.buffer);

  view.setUint32(0, crc32(concatBytes(payloadBytes, new Uint8Array(2))), true);
  view.setInt32(4, payload.length, true);
  output.set(payloadBytes, 8);
  return output;
}

function validateMuoXml(xmlText) {
  let content = xmlText.replace(/^\uFEFF/, '').trim();
  content = content.replace(/^<\?xml[^>]*>\s*/i, '');

  if (!/^<client_options(?:\s[^>]*)?>/i.test(content) || !/<\/client_options>\s*$/i.test(content)) {
    throw new Error('지원하지 않는 내보내기 파일입니다. client_options 설정 파일이 필요합니다.');
  }
}

function extractCurrentFps(xmlText) {
  const match = xmlText.match(/\bDummyCharRenderModeFPS\s*=\s*(["'])(.*?)\1/i);
  return match ? match[2] : null;
}

function patchFps(xmlText) {
  let replaced = false;
  const patched = xmlText.replace(
    /(\bDummyCharRenderModeFPS\s*=\s*)(["'])(.*?)\2/i,
    (_match, prefix, quote) => {
      replaced = true;
      return `${prefix}${quote}-1${quote}`;
    },
  );

  if (!replaced) {
    throw new Error('DummyCharRenderModeFPS 설정을 찾을 수 없습니다.');
  }
  validateMuoXml(patched);
  return patched;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

function encodeUtf16Le(text) {
  const bytes = new Uint8Array(text.length * 2);
  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text.charCodeAt(index);
    bytes[index * 2] = codeUnit & 0xff;
    bytes[index * 2 + 1] = codeUnit >> 8;
  }
  return bytes;
}

function decodeUtf16Le(bytes) {
  if (bytes.length % 2 !== 0) {
    throw new Error('UTF-16LE 데이터 길이가 올바르지 않습니다.');
  }

  const codeUnits = new Uint16Array(bytes.length / 2);
  for (let index = 0; index < bytes.length; index += 2) {
    codeUnits[index / 2] = bytes[index] | (bytes[index + 1] << 8);
  }

  let result = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < codeUnits.length; index += chunkSize) {
    result += String.fromCharCode(...codeUnits.subarray(index, index + chunkSize));
  }
  return result;
}

function concatBytes(...arrays) {
  const totalLength = arrays.reduce((sum, current) => sum + current.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const current of arrays) {
    result.set(current, offset);
    offset += current.length;
  }
  return result;
}

function makeOutputName(fileName) {
  return `${fileName.replace(/\.muo$/i, '')}_patched.muo`;
}

function setResult(type, text) {
  refs.resultBox.className = `result-box ${type}`;
  refs.resultBox.textContent = text;
}

function appendLog(message) {
  state.logLines.push(`[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${message}`);
  renderLog();
}

function renderLog() {
  refs.logOutput.textContent = state.logLines.join('\n');
  refs.copyLogButton.disabled = state.logLines.length === 0;
}

async function copyLog() {
  try {
    await navigator.clipboard.writeText(state.logLines.join('\n'));
    appendLog('로그를 클립보드에 복사했습니다.');
  } catch {
    appendLog('로그 복사에 실패했습니다. 브라우저 권한을 확인해 주세요.');
  }
}

async function copyDefaultPath() {
  try {
    await navigator.clipboard.writeText(DEFAULT_EXPORT_PATH);
    setResult('success', `내보내기·가져오기 폴더 경로를 복사했습니다: ${DEFAULT_EXPORT_PATH}`);
    appendLog(`내보내기·가져오기 폴더 경로를 복사했습니다: ${DEFAULT_EXPORT_PATH}`);
  } catch {
    setResult('warning', `경로 복사에 실패했습니다. 직접 복사해 주세요: ${DEFAULT_EXPORT_PATH}`);
    appendLog('폴더 경로 복사에 실패했습니다.');
  }
}

function formatFileSize(size) {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function downloadBytes(bytes, fileName) {
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
