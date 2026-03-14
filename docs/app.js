const SIGNATURE = new Uint8Array([0x05, 0x27, 0x8d]);
const PACK_PREFIX_NIBBLE = 0xA;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DEFAULT_CONFIG_PATH = '%APPDATA%\\Mabinogi\\Setting';

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
    if (!state.file) {
      return;
    }
    await processFile(state.file);
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
  setResult('neutral', '파일을 확인하고 있습니다. 잠시만 기다려 주세요.');
  appendLog(`파일을 선택했습니다: ${file.name}`);

  try {
    const { currentFps } = await inspectSelectedFile(file);
    refs.currentFps.textContent = currentFps;

    if (currentFps === '-1') {
      refs.processButton.disabled = false;
      setResult('warning', '현재 FPS 값은 이미 -1입니다. 필요하시면 다시 확인만 하실 수 있습니다.');
      appendLog('선택 직후 현재 FPS 값이 -1인 것을 확인했습니다.');
      return;
    }

    refs.processButton.disabled = false;
    setResult('neutral', `현재 FPS 값은 ${currentFps}입니다.\n버튼을 누르시면 설정을 수정한 뒤, 수정된 파일 다운로드를 시작합니다.`);
    appendLog(`선택 직후 현재 FPS 값을 확인했습니다: ${currentFps}`);
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
    appendLog(`처리를 시작했습니다: ${file.name}`);
    const { currentFps, xmlText } = await inspectSelectedFile(file);

    refs.currentFps.textContent = currentFps;
    appendLog(`현재 FPS 값: ${currentFps}`);

    if (currentFps === '-1') {
      setResult('warning', '이미 FPS가 -1로 설정되어 있습니다. 별도 다운로드는 진행하지 않습니다.');
      appendLog('이미 -1 상태여서 다운로드를 생략했습니다.');
      return;
    }

    const patchedText = xmlText.replace(/DummyCharRenderModeFPS="([^"]+)"/, 'DummyCharRenderModeFPS="-1"');
    validateSupportedXmlText(patchedText);
    const normalizedXmlBytes = normalizeXmlBytesFromText(patchedText);
    const outputBytes = encodeConfigBytes(normalizedXmlBytes);

    downloadBytes(outputBytes, file.name);
    refs.currentFps.textContent = '-1';
    setResult('success', `설정 수정이 완료되었습니다.\n${file.name} 파일 다운로드를 시작합니다.`);
    appendLog(`다운로드를 준비했습니다: ${file.name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setResult('error', `실패: ${message}`);
    appendLog(`오류: ${message}`);
  }
}

async function inspectSelectedFile(file) {
  const encodedBytes = new Uint8Array(await file.arrayBuffer());
  const decoded = decodeConfigBytes(encodedBytes);
  const xmlText = decodeXmlText(decoded.xmlBytes);
  const currentFps = extractCurrentFps(xmlText);

  if (currentFps === null) {
    throw new Error('DummyCharRenderModeFPS 속성을 찾을 수 없습니다.');
  }

  return { currentFps, xmlText };
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
    await navigator.clipboard.writeText(DEFAULT_CONFIG_PATH);
    setResult('success', `기본 설정 폴더 경로를 복사했습니다: ${DEFAULT_CONFIG_PATH}`);
    appendLog(`기본 경로를 복사했습니다: ${DEFAULT_CONFIG_PATH}`);
  } catch {
    setResult('warning', `경로 복사에 실패했습니다. 직접 복사해 주세요: ${DEFAULT_CONFIG_PATH}`);
    appendLog('기본 경로 복사에 실패했습니다. 브라우저 권한을 확인해 주세요.');
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

function extractCurrentFps(xmlText) {
  const match = xmlText.match(/DummyCharRenderModeFPS="([^"]+)"/);
  return match ? match[1] : null;
}

function decodeConfigBytes(encodedFileBytes) {
  const text = decodeOuterConfigText(encodedFileBytes);
  const separatorIndex = text.indexOf(';');
  if (separatorIndex < 0) {
    throw new Error('설정 파일 형식이 올바르지 않습니다.');
  }

  const expectedSize = Number.parseInt(text.slice(0, separatorIndex), 10);
  const payload = text.slice(separatorIndex + 1);
  if (!Number.isFinite(expectedSize)) {
    throw new Error('설정 파일 크기 정보를 해석할 수 없습니다.');
  }

  const decoded = decodeWithTrailingTrim(payload, expectedSize);
  return {
    expectedSize,
    packedBytes: decoded.packedBytes,
    xmlBytes: decoded.xmlBytes,
  };
}

function decodeOuterConfigText(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return decodeUtf16Le(bytes.subarray(2));
  }
  return decodeUtf16Le(bytes);
}

function decodeXmlText(xmlBytes) {
  const attempts = [
    () => {
      if (xmlBytes.length >= 2 && xmlBytes[0] === 0xff && xmlBytes[1] === 0xfe) {
        return decodeUtf16Le(xmlBytes.subarray(2));
      }
      return decodeUtf16Le(xmlBytes);
    },
    () => new TextDecoder('utf-8', { fatal: true }).decode(xmlBytes).replace(/^\uFEFF/, ''),
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      return attempt();
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`XML 파일 인코딩을 해석할 수 없습니다. ${String(lastError ?? '')}`.trim());
}

function validateSupportedXmlText(text) {
  let cleaned = text.replace(/^[\uFEFF\x00\r\n\t ]+|[\uFEFF\x00\r\n\t ]+$/g, '');
  cleaned = cleaned.replace(/^<\?xml[^>]*>\s*/i, '');
  cleaned = cleaned.replace(/^[\uFEFF\x00\r\n\t ]+|[\uFEFF\x00\r\n\t ]+$/g, '');

  const startsWithOptions = /^<options(?:\s[^>]*)?>/i.test(cleaned);
  const endsWithOptions = /<\/options>\s*$/i.test(cleaned);
  const startsWithUi = /^<ui(?:\s[^>]*)?>/i.test(cleaned);
  const endsWithUi = /<\/ui>\s*$/i.test(cleaned);

  if (!((startsWithOptions && endsWithOptions) || (startsWithUi && endsWithUi))) {
    throw new Error('올바른 형식의 XML 파일이 아닙니다. <options>...</options> 또는 <ui>...</ui> 형식이어야 합니다.');
  }
}

function normalizeXmlBytesFromText(text) {
  let normalized = text.replace(/^\uFEFF/, '');
  const newline = normalized.includes('\r\n') ? '\r\n' : '\n';

  const optionMatch = /<\/options>/i.exec(normalized);
  const uiMatch = /<\/ui>/i.exec(normalized);
  const closingMatch = optionMatch || uiMatch;

  if (closingMatch) {
    normalized = normalized.slice(0, closingMatch.index + closingMatch[0].length);
    normalized = normalized.replace(/[\r\n\t \x00]+$/g, '') + newline + '\x00';
  }

  return encodeUtf16Le(normalized);
}

function decodeWithTrailingTrim(payload, expectedSize) {
  const attempts = [];
  const maxTrim = Math.min(8, payload.length);

  for (let trimCount = 0; trimCount < maxTrim; trimCount += 1) {
    const candidate = trimCount === 0 ? payload : payload.slice(0, -trimCount);
    try {
      const packedBytes = tryDecodePayload(candidate);
      const rawDeflate = unpackShiftedDeflate(packedBytes, SIGNATURE.length, 4);
      const xmlBytes = inflateRawWithFallback(rawDeflate);
      if (xmlBytes.length !== expectedSize) {
        attempts.push(`trim=${trimCount}: size=${xmlBytes.length}`);
        continue;
      }
      return { packedBytes, xmlBytes, trimCount };
    } catch (error) {
      attempts.push(`trim=${trimCount}: ${String(error)}`);
    }
  }

  const lastError = attempts[attempts.length - 1] || 'unknown error';
  throw new Error(`Base64 본문을 해석하지 못했습니다. 마지막 오류=${lastError}`);
}

function tryDecodePayload(payload) {
  const paddingLength = (4 - (payload.length % 4)) % 4;
  return base64ToBytes(payload + '='.repeat(paddingLength));
}

function unpackShiftedDeflate(data, headerBytes = 3, bitShift = 4) {
  const body = data.subarray(headerBytes);
  if (body.length < 2) {
    throw new Error('decoded payload is too short');
  }

  const result = new Uint8Array(body.length - 1);
  for (let index = 0; index < body.length - 1; index += 1) {
    result[index] = (((body[index] << bitShift) & 0xff) | (body[index + 1] >> (8 - bitShift))) & 0xff;
  }
  return result;
}

function packShiftedDeflate(rawDeflate) {
  if (rawDeflate.length === 0) {
    return new Uint8Array();
  }

  const packed = new Uint8Array(rawDeflate.length + 1);
  packed[0] = (PACK_PREFIX_NIBBLE << 4) | (rawDeflate[0] >> 4);
  for (let index = 1; index < rawDeflate.length; index += 1) {
    packed[index] = ((rawDeflate[index - 1] & 0x0f) << 4) | (rawDeflate[index] >> 4);
  }
  packed[packed.length - 1] = (rawDeflate[rawDeflate.length - 1] & 0x0f) << 4;
  return packed.subarray(0, packed.length - 1);
}

function encodeConfigBytes(xmlBytes) {
  const rawDeflate = window.pako.deflateRaw(xmlBytes, { level: 9 });
  const adlerBytes = uint32ToBytes(adler32(xmlBytes));
  const packedSource = concatBytes(rawDeflate, adlerBytes);
  const packed = concatBytes(SIGNATURE, packShiftedDeflate(packedSource));
  const payload = encodeGameBase64(packed, packedSource[packedSource.length - 1] & 0x0f);
  const text = `${xmlBytes.length};${payload}`;
  return encodeUtf16Le(text, true);
}

function encodeGameBase64(data, trailingPadNibble = 0x0f) {
  const encoded = bytesToBase64(data);
  if (encoded.endsWith('==')) {
    const trimmed = encoded.slice(0, -2);
    const lastValue = BASE64_ALPHABET.indexOf(trimmed.at(-1));
    return trimmed.slice(0, -1) + BASE64_ALPHABET[lastValue | (trailingPadNibble & 0x0f)];
  }
  if (encoded.endsWith('=')) {
    const trimmed = encoded.slice(0, -1);
    const lastValue = BASE64_ALPHABET.indexOf(trimmed.at(-1));
    return trimmed.slice(0, -1) + BASE64_ALPHABET[lastValue | 0x03];
  }
  return encoded;
}

function inflateRawWithFallback(data) {
  try {
    return new Uint8Array(window.pako.inflateRaw(data));
  } catch (firstError) {
    if (data.length > 4) {
      return new Uint8Array(window.pako.inflateRaw(data.subarray(0, data.length - 4)));
    }
    throw firstError;
  }
}

function encodeUtf16Le(text, withBom = false) {
  const bytes = new Uint8Array(text.length * 2 + (withBom ? 2 : 0));
  let offset = 0;

  if (withBom) {
    bytes[0] = 0xff;
    bytes[1] = 0xfe;
    offset = 2;
  }

  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text.charCodeAt(index);
    bytes[offset] = codeUnit & 0xff;
    bytes[offset + 1] = codeUnit >> 8;
    offset += 2;
  }

  return bytes;
}

function decodeUtf16Le(bytes) {
  if (bytes.length % 2 !== 0) {
    throw new Error('UTF-16LE byte length must be even');
  }

  const codeUnits = new Uint16Array(bytes.length / 2);
  for (let index = 0; index < bytes.length; index += 2) {
    codeUnits[index / 2] = bytes[index] | (bytes[index + 1] << 8);
  }

  const chunkSize = 0x8000;
  let result = '';
  for (let index = 0; index < codeUnits.length; index += chunkSize) {
    result += String.fromCharCode(...codeUnits.subarray(index, index + chunkSize));
  }
  return result;
}

function uint32ToBytes(value) {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    a = (a + bytes[index]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
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

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function downloadBytes(bytes, fileName) {
  const blob = new Blob([bytes], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
