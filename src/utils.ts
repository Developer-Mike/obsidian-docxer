export function toValidFilename(filename: string): string {
  let validFilename = filename.replace(/[^a-zA-Z0-9öüäÖÜÄ.\-]/g, "");
  return validFilename;
}