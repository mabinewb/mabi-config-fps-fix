const DEFAULT_EXPORT_PATH = '문서\\마비노기\\설정\\목록';
const LEGACY_XML_SIGNATURE = new Uint8Array([0x05, 0x27, 0x8d]);
const PACK_PREFIX_NIBBLE = 0xA;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const MUO2_MAGIC = 'MUO2';
const MUO2_VERSION = 1;
const MUO2_FLAGS = 0x0007;
const MUO2_KEY_SEED_HEX = '7a145a9f319947b9faaf2488b8bbbe63';
const MUO2_KEY_SUFFIX = 'MUO_FILE_KEY_V1';

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
  setResult('neutral', '설정 파일 형식을 확인하고 있습니다.');
  appendLog(`파일을 선택했습니다: ${file.name}`);

  try {
    const decoded = await readSupportedFile(file);
    refs.currentFps.textContent = decoded.currentFps;
    refs.processButton.disabled = decoded.currentFps === '-1';

    if (decoded.currentFps === '-1') {
      setResult('warning', `${decoded.formatLabel} 파일입니다.\n현재 FPS 값이 이미 -1이므로 수정할 필요가 없습니다.`);
      appendLog(`${decoded.formatLabel} 파일이며 FPS 값은 이미 -1입니다.`);
      return;
    }

    setResult(
      'neutral',
      `${decoded.formatLabel} 파일입니다.\n현재 FPS 값은 ${decoded.currentFps}입니다.\n버튼을 누르면 같은 계열의 수정 파일을 다운로드합니다.`,
    );
    appendLog(`${decoded.formatLabel} 파일로 확인했습니다. 현재 FPS 값: ${decoded.currentFps}`);
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
    const decoded = await readSupportedFile(file);
    refs.currentFps.textContent = decoded.currentFps;

    if (decoded.currentFps === '-1') {
      setResult('warning', '이미 FPS가 -1로 설정되어 있어 다운로드하지 않았습니다.');
      appendLog('이미 -1 상태여서 다운로드를 생략했습니다.');
      return;
    }

    const patchedText = patchFps(decoded.xmlText);
    const outputBytes = await encodeOutputForFormat(decoded.format, patchedText);
    const outputName = makeOutputName(file.name, decoded.format);

    downloadBytes(outputBytes, outputName, decoded.format === 'legacyXmlConfig' || decoded.format === 'plainXml' ? 'application/xml' : 'application/octet-stream');
    refs.currentFps.textContent = '-1';
    refs.processButton.disabled = true;
    setResult('success', buildSuccessMessage(outputName, decoded.format));
    appendLog(`수정 파일 다운로드를 준비했습니다: ${outputName}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setResult('error', `실패: ${message}`);
    appendLog(`오류: ${message}`);
  }
}

async function readSupportedFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = file.name.toLowerCase().split('.').pop() || '';
  const attempts = [];

  const decoders = ext === 'xml'
    ? [decodeLegacyXmlConfigFile, decodePlainXmlFile, decodeMuoFile]
    : [decodeMuoFile, decodeLegacyXmlConfigFile, decodePlainXmlFile];

  for (const decoder of decoders) {
    try {
      const decoded = await decoder(bytes);
      decoded.currentFps = extractCurrentFps(decoded.xmlText);
      if (decoded.currentFps === null) {
        throw new Error('DummyCharRenderModeFPS 설정을 찾을 수 없습니다.');
      }
      return decoded;
    } catch (error) {
      attempts.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(`지원하는 설정 파일 형식이 아닙니다. 마지막 오류: ${attempts.at(-1)}`);
}

async function decodeMuoFile(bytes) {
  if (isMuo2(bytes)) {
    return {
      format: 'muo2',
      formatLabel: 'MUO',
      xmlText: await decodeMuo2(bytes),
    };
  }

  return {
    format: 'legacyMuo',
    formatLabel: 'MUO',
    xmlText: decodeLegacyMuo(bytes),
  };
}

function decodeLegacyXmlConfigFile(bytes) {
  const decoded = decodeLegacyXmlConfigBytes(bytes);
  const xmlText = stripXmlPadding(decodeXmlText(decoded.xmlBytes));
  validateAnySupportedXml(xmlText);
  return {
    format: 'legacyXmlConfig',
    formatLabel: 'XML',
    xmlText,
  };
}

function decodePlainXmlFile(bytes) {
  const xmlText = stripXmlPadding(decodeXmlText(bytes));
  validateAnySupportedXml(xmlText);
  return {
    format: 'plainXml',
    formatLabel: 'XML',
    xmlText,
  };
}

function isMuo2(bytes) {
  return bytes.length >= 4 && String.fromCharCode(...bytes.subarray(0, 4)) === MUO2_MAGIC;
}

async function decodeMuo2(bytes) {
  if (bytes.length < 0x24) {
    throw new Error('MUO 파일이 너무 짧습니다.');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(0x04, true);
  const flags = view.getUint16(0x06, true);
  const storedCount = view.getUint32(0x08, true);
  const storedCrc = view.getUint32(0x0c, true);
  const iv = bytes.slice(0x10, 0x20);
  const repeatedCount = view.getUint32(0x20, true);

  if (version !== MUO2_VERSION) {
    throw new Error(`지원하지 않는 MUO 파일 버전입니다: ${version}`);
  }
  if (storedCount !== repeatedCount || bytes.length !== 0x24 + storedCount * 2) {
    throw new Error('MUO 저장 문자열 길이가 헤더 정보와 일치하지 않습니다.');
  }

  const storedText = decodeUtf16Le(bytes.subarray(0x24));
  const innerText = flags & 0x02
    ? new TextDecoder('utf-8', { fatal: true }).decode(await aesCbcDecrypt(base64ToBytes(storedText), iv))
    : storedText;

  verifyInnerPayloadCrc(innerText, storedCrc);
  return decodeInnerPayloadToXmlText(innerText);
}

async function encodeMuo2(xmlText) {
  validateAnySupportedXml(xmlText);
  const innerText = encodeInnerPayloadFromXmlText(xmlText);
  const innerCrc = crc32(concatBytes(encodeUtf16Le(innerText), new Uint8Array(2)));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const encrypted = await aesCbcEncrypt(new TextEncoder().encode(innerText), iv);
  const storedText = bytesToBase64(encrypted);
  const storedBytes = encodeUtf16Le(storedText);
  const output = new Uint8Array(0x24 + storedBytes.length);
  const view = new DataView(output.buffer);

  writeAscii(output, 0, MUO2_MAGIC);
  view.setUint16(0x04, MUO2_VERSION, true);
  view.setUint16(0x06, MUO2_FLAGS, true);
  view.setUint32(0x08, storedText.length, true);
  view.setUint32(0x0c, innerCrc, true);
  output.set(iv, 0x10);
  view.setUint32(0x20, storedText.length, true);
  output.set(storedBytes, 0x24);
  return output;
}

function decodeLegacyMuo(bytes) {
  if (bytes.length < 8) {
    throw new Error('MUO 파일이 너무 짧습니다.');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const storedCrc = view.getUint32(0, true);
  const characterCount = view.getUint32(4, true);

  if (bytes.length !== 8 + characterCount * 2) {
    throw new Error('MUO 본문 길이가 헤더 정보와 일치하지 않습니다.');
  }

  const innerText = decodeUtf16Le(bytes.subarray(8));
  verifyInnerPayloadCrc(innerText, storedCrc);
  return decodeInnerPayloadToXmlText(innerText);
}

function encodeLegacyMuo(xmlText) {
  validateAnySupportedXml(xmlText);
  const innerText = encodeInnerPayloadFromXmlText(xmlText);
  const innerBytes = encodeUtf16Le(innerText);
  const output = new Uint8Array(8 + innerBytes.length);
  const view = new DataView(output.buffer);

  view.setUint32(0, crc32(concatBytes(innerBytes, new Uint8Array(2))), true);
  view.setUint32(4, innerText.length, true);
  output.set(innerBytes, 8);
  return output;
}

function decodeInnerPayloadToXmlText(innerText) {
  const separatorIndex = innerText.indexOf(';');
  if (separatorIndex <= 0) {
    throw new Error('내부 압축 정보가 올바르지 않습니다.');
  }

  const expectedSizeText = innerText.slice(0, separatorIndex);
  if (!/^\d+$/.test(expectedSizeText)) {
    throw new Error('내부 XML 크기 정보를 해석할 수 없습니다.');
  }

  const expectedSize = Number.parseInt(expectedSizeText, 10);
  const compressedHex = innerText.slice(separatorIndex + 1);
  if (compressedHex.length === 0 || compressedHex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(compressedHex)) {
    throw new Error('내부 압축 데이터가 올바른 소문자 16진수 형식이 아닙니다.');
  }

  let xmlBytes;
  try {
    xmlBytes = new Uint8Array(window.pako.inflate(hexToBytes(compressedHex)));
  } catch {
    throw new Error('내부 XML 압축을 해제하지 못했습니다.');
  }

  if (xmlBytes.length !== expectedSize) {
    throw new Error(`압축 해제 크기가 일치하지 않습니다. 예상 ${expectedSize}바이트, 실제 ${xmlBytes.length}바이트입니다.`);
  }
  if (xmlBytes.length < 2 || xmlBytes.at(-2) !== 0 || xmlBytes.at(-1) !== 0) {
    throw new Error('내부 XML에 UTF-16 종료 문자가 없습니다.');
  }

  const xmlText = decodeUtf16Le(xmlBytes.subarray(0, -2)).replace(/^\uFEFF/, '');
  validateAnySupportedXml(xmlText);
  return xmlText;
}

function encodeInnerPayloadFromXmlText(xmlText) {
  const xmlBytes = encodeUtf16Le(xmlText.replace(/^\uFEFF/, '') + '\x00');
  const compressedBytes = new Uint8Array(window.pako.deflate(xmlBytes, { level: 6 }));
  return `${xmlBytes.length};${bytesToHex(compressedBytes)}`;
}

function verifyInnerPayloadCrc(innerText, storedCrc) {
  const actualCrc = crc32(concatBytes(encodeUtf16Le(innerText), new Uint8Array(2)));
  if (actualCrc !== storedCrc) {
    throw new Error('CRC32 검증에 실패했습니다. 파일이 손상되었을 수 있습니다.');
  }
}

async function aesCbcEncrypt(plainBytes, iv) {
  const key = await getMuo2CryptoKey(['encrypt']);
  return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, plainBytes));
}

async function aesCbcDecrypt(cipherBytes, iv) {
  const key = await getMuo2CryptoKey(['decrypt']);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, cipherBytes));
}

async function getMuo2CryptoKey(usages) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('이 브라우저는 MUO 파일 암호화를 지원하지 않습니다. 최신 브라우저 또는 HTTPS 페이지에서 다시 시도해 주세요.');
  }

  const seedBytes = hexToBytes(MUO2_KEY_SEED_HEX);
  const suffixBytes = new TextEncoder().encode(MUO2_KEY_SUFFIX);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', concatBytes(seedBytes, suffixBytes)));
  return globalThis.crypto.subtle.importKey('raw', digest.slice(0, 16), { name: 'AES-CBC' }, false, usages);
}

function decodeLegacyXmlConfigBytes(encodedFileBytes) {
  const text = decodeOuterConfigText(encodedFileBytes);
  const separatorIndex = text.indexOf(';');
  if (separatorIndex < 0) {
    throw new Error('예전 XML 설정 파일 형식이 올바르지 않습니다.');
  }

  const expectedSize = Number.parseInt(text.slice(0, separatorIndex), 10);
  const payload = text.slice(separatorIndex + 1);
  if (!Number.isFinite(expectedSize)) {
    throw new Error('예전 XML 설정 파일 크기 정보를 해석할 수 없습니다.');
  }

  const decoded = decodeLegacyXmlPayload(payload, expectedSize);
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

function decodeLegacyXmlPayload(payload, expectedSize) {
  const attempts = [];
  const maxTrim = Math.min(8, payload.length);

  for (let trimCount = 0; trimCount < maxTrim; trimCount += 1) {
    const candidate = trimCount === 0 ? payload : payload.slice(0, -trimCount);
    try {
      const packedBytes = tryDecodePayload(candidate);
      const rawDeflate = unpackShiftedDeflate(packedBytes, LEGACY_XML_SIGNATURE.length, 4);
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
  throw new Error(`예전 XML 설정 파일 Base64 본문을 해석하지 못했습니다. 마지막 오류=${lastError}`);
}

function encodeLegacyXmlConfig(xmlText) {
  validateAnySupportedXml(xmlText);
  const xmlBytes = normalizeLegacyXmlBytes(xmlText);
  const rawDeflate = window.pako.deflateRaw(xmlBytes, { level: 9 });
  const adlerBytes = uint32ToBytes(adler32(xmlBytes));
  const packedSource = concatBytes(rawDeflate, adlerBytes);
  const packed = concatBytes(LEGACY_XML_SIGNATURE, packShiftedDeflate(packedSource));
  const payload = encodeGameBase64(packed, packedSource[packedSource.length - 1] & 0x0f);
  const text = `${xmlBytes.length};${payload}`;
  return encodeUtf16Le(text, true);
}

function normalizeLegacyXmlBytes(text) {
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

async function encodeOutputForFormat(format, xmlText) {
  switch (format) {
    case 'muo2':
      return encodeMuo2(xmlText);
    case 'legacyMuo':
      return encodeLegacyMuo(xmlText);
    case 'legacyXmlConfig':
      return encodeLegacyXmlConfig(xmlText);
    case 'plainXml':
      return new TextEncoder().encode(xmlText);
    default:
      throw new Error(`지원하지 않는 출력 형식입니다: ${format}`);
  }
}

function validateAnySupportedXml(xmlText) {
  let content = stripXmlPadding(xmlText).replace(/^\uFEFF/, '').trim();
  content = content.replace(/^<\?xml[^>]*>\s*/i, '');

  const isClientOptions = /^<client_options(?:\s[^>]*)?>/i.test(content) && /<\/client_options>\s*$/i.test(content);
  const isOptions = /^<options(?:\s[^>]*)?>/i.test(content) && /<\/options>\s*$/i.test(content);
  const isUi = /^<ui(?:\s[^>]*)?>/i.test(content) && /<\/ui>\s*$/i.test(content);

  if (!(isClientOptions || isOptions || isUi)) {
    throw new Error('지원하지 않는 XML입니다. <client_options>, <options>, <ui> 형식이 필요합니다.');
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
  validateAnySupportedXml(patched);
  return patched;
}

function decodeXmlText(xmlBytes) {
  const candidates = [];
  const errors = [];

  if (xmlBytes.length >= 2 && xmlBytes[0] === 0xff && xmlBytes[1] === 0xfe) {
    try {
      candidates.push(decodeUtf16Le(xmlBytes.subarray(2)));
    } catch (error) {
      errors.push(error);
    }
  }

  try {
    candidates.push(new TextDecoder('utf-8', { fatal: true }).decode(xmlBytes).replace(/^\uFEFF/, ''));
  } catch (error) {
    errors.push(error);
  }

  if (xmlBytes.length % 2 === 0) {
    try {
      candidates.push(decodeUtf16Le(xmlBytes).replace(/^\uFEFF/, ''));
    } catch (error) {
      errors.push(error);
    }
  }

  for (const candidate of candidates) {
    if (looksLikeSupportedXml(candidate)) {
      return stripXmlPadding(candidate);
    }
  }

  if (candidates.length > 0) {
    return stripXmlPadding(candidates[0]);
  }

  throw new Error(`XML 파일 인코딩을 해석할 수 없습니다. ${String(errors.at(-1) ?? '')}`.trim());
}

function stripXmlPadding(text) {
  return text.replace(/^\uFEFF/, '').replace(/[\x00\r\n\t ]+$/g, '');
}

function looksLikeSupportedXml(text) {
  let content = stripXmlPadding(text).trim();
  content = content.replace(/^<\?xml[^>]*>\s*/i, '');
  return /^<(client_options|options|ui)(?:\s[^>]*)?>/i.test(content);
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

function writeAscii(bytes, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    bytes[offset + index] = text.charCodeAt(index);
  }
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

function makeOutputName(fileName, format) {
  const baseName = fileName.replace(/\.(muo|xml)$/i, '');
  if (format === 'legacyXmlConfig' || format === 'plainXml') {
    return `${baseName}_patched.xml`;
  }
  return `${baseName}_patched.muo`;
}

function buildSuccessMessage(outputName, format) {
  if (format === 'muo2' || format === 'legacyMuo') {
    return `설정 수정이 완료되었습니다.\n${outputName} 파일을 "${DEFAULT_EXPORT_PATH}" 폴더로 이동하세요.\n그다음 게임의 "환경설정 → 환경설정 내보내기/가져오기"에서 가져오기 버튼을 누르고 "환경설정 → 그래픽-효과"만 체크하여 가져오세요.`;
  }
  return `설정 수정이 완료되었습니다.\n${outputName} 파일 다운로드를 시작합니다.`;
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

function downloadBytes(bytes, fileName, mimeType = 'application/octet-stream') {
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
