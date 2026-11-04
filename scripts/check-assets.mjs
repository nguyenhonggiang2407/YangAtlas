import { readFile, access, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, relative } from "node:path";
import assert from "node:assert/strict";
import {
  places,
  destinations,
  photoCredits,
  sampleTrips,
} from "../src/catalog.js";
import { validateState } from "../src/domain.js";
const root = await realpath(".");
const manifest = JSON.parse(
  await readFile("LICENSES/photos/manifest.json", "utf8"),
);
const fonts = JSON.parse(
  await readFile("LICENSES/fonts/manifest.json", "utf8"),
);
const checks = [];
async function verified(file, sha) {
  const path = await realpath(resolve(file));
  assert.ok(
    !relative(root, path).startsWith(".."),
    "Asset must stay inside checkout",
  );
  const bytes = await readFile(path);
  if (sha)
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      sha,
      "Source hash mismatch: " + file,
    );
  checks.push(file);
  return bytes;
}
assert.equal(manifest.photos.length, photoCredits.length);
for (const photo of manifest.photos) {
  const bytes = await verified(photo.file, photo.sha256);
  assert.equal(bytes.length, photo.bytes);
  assert.equal(bytes.readUInt16BE(0), 0xffd8);
  assert.ok(
    photo.author &&
      photo.license &&
      photo.sourceUrl.startsWith("https://commons.wikimedia.org/wiki/File:"),
  );
  const credit = photoCredits.find((entry) => entry.id === photo.id);
  assert.ok(credit);
  assert.equal(credit.sourceUrl, photo.sourceUrl);
  assert.equal(credit.image, "./" + photo.file.replace(/^public\//, ""));
}
for (const font of fonts.files) {
  if (font.file) await verified(font.file, font.sha256);
  if (font.licenseFile)
    assert.match(
      await readFile(font.licenseFile, "utf8"),
      /SIL OPEN FONT LICENSE/,
    );
}
const local = async (path) =>
  access(resolve("public", path.replace(/^\.\//, "")));
for (const destination of Object.values(destinations))
  await local(destination.cover);
for (const place of places) {
  await local(place.image);
  assert.ok(photoCredits.some((p) => p.id === place.photoId));
  assert.ok(place.imageCaption);
  assert.equal(new URL(place.sourceUrl).protocol, "https:");
  assert.ok(Number.isFinite(place.lat) && Number.isFinite(place.lng));
}
validateState({
  version: 1,
  activeTripId: sampleTrips[0].id,
  trips: sampleTrips,
});
assert.ok(
  !(await readFile("src/fonts.css", "utf8")).match(/url\(['"]?https?:/),
);
console.log(
  JSON.stringify({
    photos: manifest.photos.length,
    fonts: fonts.files.filter((x) => x.file).length,
    curatedPlaces: places.length,
    sampleTrips: sampleTrips.length,
    checkedFiles: checks.length,
    sha256Verified: true,
    selfHostedFonts: true,
  }),
);
