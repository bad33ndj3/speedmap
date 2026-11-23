// Points are stored in the orientation currently shown to the user.
export function rotateClockwise(spot) {
  return { ...spot, x: 1 - spot.y, y: spot.x };
}

export function layoutFloorplan(image, map, rotation) {
  if (!image.naturalWidth || !image.naturalHeight || image.hidden) return;
  const odd = rotation % 180 !== 0;
  const width = odd ? image.naturalHeight : image.naturalWidth;
  const height = odd ? image.naturalWidth : image.naturalHeight;
  map.style.width = `min(100%, ${width}px)`;
  map.style.aspectRatio = `${width} / ${height}`;
  image.style.position = 'absolute';
  image.style.left = '50%';
  image.style.top = '50%';
  image.style.maxWidth = 'none';
  image.style.width = `${odd ? image.naturalWidth / image.naturalHeight * 100 : 100}%`;
  image.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
}
