// Downscale + compress a photo to a small JPEG Blob (for upload) plus a preview URL.
export type ShrunkPhoto = { blob: Blob; previewUrl: string };

export async function shrinkImage(
	file: File,
	maxEdge = 1024,
	quality = 0.7
): Promise<ShrunkPhoto> {
	const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
	const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
	const w = Math.round(bitmap.width * scale);
	const h = Math.round(bitmap.height * scale);

	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('canvas 2d indisponible');
	ctx.drawImage(bitmap, 0, 0, w, h);
	bitmap.close();

	const blob = await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(b) => (b ? resolve(b) : reject(new Error('compression photo impossible'))),
			'image/jpeg',
			quality
		);
	});
	return { blob, previewUrl: URL.createObjectURL(blob) };
}
