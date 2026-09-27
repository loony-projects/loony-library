export function imageType(bytes) {
  if (
    bytes?.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "png";
  if (bytes?.[0] === 255 && bytes?.[1] === 216 && bytes?.[2] === 255)
    return "jpg";
  if (
    bytes?.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP"
  )
    return "webp";
  return null;
}
