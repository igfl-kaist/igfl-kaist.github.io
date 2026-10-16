export function validateTeamImage(data, decode) {
  if (typeof data !== "string" || data.length > 210000) return false;
  const match =
    /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  if (!match || match[2].length % 4) return false;
  let bytes;
  try {
    bytes = decode(match[2]).map((n) => (n + 256) % 256);
  } catch {
    return false;
  }
  if (bytes.length > 150000 || bytes.length < 24) return false;
  const u32be = (i) =>
    bytes[i] * 16777216 +
    bytes[i + 1] * 65536 +
    bytes[i + 2] * 256 +
    bytes[i + 3];
  let width = 0,
    height = 0;
  if (match[1] === "png") {
    if (
      bytes.slice(0, 8).join(",") !== "137,80,78,71,13,10,26,10" ||
      String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR"
    )
      return false;
    width = u32be(16);
    height = u32be(20);
    if (String.fromCharCode(...bytes.slice(-8, -4)) !== "IEND") return false;
  } else if (match[1] === "jpeg") {
    if (
      bytes[0] !== 255 ||
      bytes[1] !== 216 ||
      bytes.at(-2) !== 255 ||
      bytes.at(-1) !== 217
    )
      return false;
    for (let i = 2; i < bytes.length - 9; ) {
      if (bytes[i] !== 255) return false;
      const marker = bytes[i + 1],
        len = bytes[i + 2] * 256 + bytes[i + 3];
      if (len < 2) return false;
      if ([192, 193, 194].includes(marker)) {
        height = bytes[i + 5] * 256 + bytes[i + 6];
        width = bytes[i + 7] * 256 + bytes[i + 8];
        break;
      }
      i += 2 + len;
    }
  } else {
    if (
      String.fromCharCode(...bytes.slice(0, 4)) !== "RIFF" ||
      String.fromCharCode(...bytes.slice(8, 12)) !== "WEBP"
    )
      return false;
    const kind = String.fromCharCode(...bytes.slice(12, 16));
    if (
      kind === "VP8 " &&
      bytes[23] === 157 &&
      bytes[24] === 1 &&
      bytes[25] === 42
    ) {
      width = (bytes[26] + bytes[27] * 256) & 16383;
      height = (bytes[28] + bytes[29] * 256) & 16383;
    } else if (kind === "VP8L" && bytes[20] === 47) {
      width = 1 + ((bytes[21] | (bytes[22] << 8)) & 16383);
      height =
        1 + (((bytes[22] >> 6) | (bytes[23] << 2) | (bytes[24] << 10)) & 16383);
    } else if (kind === "VP8X") {
      width = 1 + bytes[24] + bytes[25] * 256 + bytes[26] * 65536;
      height = 1 + bytes[27] + bytes[28] * 256 + bytes[29] * 65536;
    }
  }
  return width > 0 && height > 0 && width <= 1024 && height <= 1024;
}
