const sharp = require('sharp');
const { ApiError, textField } = require('./contract.cjs');
const TEXT_MODEL = 'Xenova/all-MiniLM-L6-v2';
const IMAGE_MODEL = 'Xenova/vit-base-patch16-224';
const MAX_UPLOAD = 4 * 1024 * 1024;

class ModelRegistry {
  constructor(factory = loadModel) {
    this.factory = factory;
    this.pending = new Map();
  }
  async get(name) {
    if (!this.pending.has(name)) {
      const pending = Promise.resolve()
        .then(() => this.factory(name))
        .catch(() => {
          this.pending.delete(name);
          throw new ApiError(`The ${name} model is unavailable.`, 503);
        });
      this.pending.set(name, pending);
    }
    return this.pending.get(name);
  }
}
async function loadModel(name) {
  const { pipeline, env, RawImage } = await import('@huggingface/transformers');
  env.cacheDir = process.env.MODEL_CACHE_DIR || 'models';
  if (name === 'text') {
    const model = await pipeline('feature-extraction', TEXT_MODEL, { device: 'cpu', dtype: 'q8' });
    return {
      model_id: TEXT_MODEL,
      async embed(text) {
        const tensor = await model(text, { pooling: 'mean', normalize: true });
        return Array.from(tensor.data).slice(0, tensor.dims.at(-1));
      },
    };
  }
  const classifier = await pipeline('image-classification', IMAGE_MODEL, {
    device: 'cpu',
    dtype: 'q8',
  });
  const extractor = await pipeline('image-feature-extraction', IMAGE_MODEL, {
    device: 'cpu',
    dtype: 'q8',
  });
  const rawImage = (image) =>
    new RawImage(new Uint8ClampedArray(image.pixels), image.width, image.height, 3);
  return {
    model_id: IMAGE_MODEL,
    classify: (image) => classifier(rawImage(image), { top_k: 5 }),
    async embed(image) {
      const tensor = await extractor(rawImage(image), { pool: false });
      return Array.from(tensor.data).slice(0, tensor.dims.at(-1));
    },
  };
}
async function decodeImage(file) {
  if (!file) throw new ApiError("Multipart field 'file' is required.");
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype))
    throw new ApiError('Unsupported image media type.', 415);
  if (file.buffer.length > MAX_UPLOAD) throw new ApiError('Image exceeds 4 MiB.', 413);
  try {
    const input = sharp(file.buffer, { limitInputPixels: 20000000, failOn: 'warning' });
    const metadata = await input.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format))
      throw new ApiError('Unsupported image format.', 415);
    const { data, info } = await input
      .rotate()
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true });
    return {
      pixels: data,
      width: info.width,
      height: info.height,
      format: metadata.format.toUpperCase(),
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (/pixel limit/i.test(error.message))
      throw new ApiError('Image dimensions exceed the limit.', 413);
    throw new ApiError('Invalid image.');
  }
}
function cosine(left, right) {
  const dot = left.reduce((sum, value, index) => sum + value * right[index], 0);
  const length = (values) => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  const denominator = length(left) * length(right);
  return denominator ? Math.max(-1, Math.min(1, dot / denominator)) : 0;
}
function vectorResponse(model, embedding) {
  return { model: model.model_id, dimension: embedding.length, embedding };
}
function createHeavy(registry = new ModelRegistry()) {
  let active = false;
  const bounded = async (operation) => {
    if (active) throw new ApiError('One inference request is already running.', 429);
    active = true;
    try {
      return await operation();
    } finally {
      active = false;
    }
  };
  return {
    ready: () =>
      bounded(async () => {
        const models = {};
        for (const name of ['text', 'image']) {
          try {
            await registry.get(name);
            models[name] = true;
          } catch {
            models[name] = false;
          }
        }
        return {
          statusCode: Object.values(models).every(Boolean) ? 200 : 503,
          body: {
            status: Object.values(models).every(Boolean) ? 'ready' : 'unavailable',
            models,
            device: 'cpu',
          },
        };
      }),
    textEmbedding: (payload) =>
      bounded(async () => {
        const text = textField(payload, 'text');
        const model = await registry.get('text');
        return vectorResponse(model, await model.embed(text));
      }),
    similarity: (payload) =>
      bounded(async () => {
        const left = textField(payload, 'left'),
          right = textField(payload, 'right');
        const model = await registry.get('text');
        return {
          model: model.model_id,
          similarity: cosine(await model.embed(left), await model.embed(right)),
        };
      }),
    imageAnalyze: (file) =>
      bounded(async () => {
        const decoded = await decodeImage(file);
        const model = await registry.get('image');
        const { width, height, format } = decoded;
        return {
          model: model.model_id,
          image: { width, height, format },
          predictions: await model.classify(decoded),
        };
      }),
    imageEmbedding: (file) =>
      bounded(async () => {
        const decoded = await decodeImage(file);
        const model = await registry.get('image');
        return vectorResponse(model, await model.embed(decoded));
      }),
  };
}
module.exports = { MAX_UPLOAD, ModelRegistry, createHeavy, cosine, decodeImage };
