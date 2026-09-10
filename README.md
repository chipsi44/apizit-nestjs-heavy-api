# APIZIT NestJS Heavy reference API

Run a predictable API locally and compare its behavior with the Flask,
FastAPI and Linking reference fixtures. This repository is standalone and MIT licensed.
The public Light repository and its private mirror contain identical files.

## Run locally

```sh
npm ci
npm run build
npm start
```

The default URL is `http://127.0.0.1:8000`. No database, account or cloud credentials
are needed. This is a development fixture, not a production service.

## HTTP contract

| Method | Path               |
| ------ | ------------------ |
| `GET`  | `/health`          |
| `GET`  | `/info`            |
| `POST` | `/echo`            |
| `GET`  | `/items/{item_id}` |
| `GET`  | `/slow`            |
| `GET`  | `/ready`           |
| `POST` | `/text/embedding`  |
| `POST` | `/text/similarity` |
| `POST` | `/image/analyze`   |
| `POST` | `/image/embedding` |

- `GET /health` returns exactly `{"status":"ok"}` without loading models.
- `GET /info` identifies `framework: "nestjs"` and `profile: "heavy"`.
- `POST /echo` accepts `{"message":"hello","count":2}` and returns
  `{"received":{"message":"hello","count":2}}`. Count must be an integer,
  never a boolean; message must be a nonempty string.
- `GET /items/7?include_details=true` returns
  `{"item_id":7,"include_details":true,"details":"Reference item 7"}`.
  Details are omitted by default. IDs are positive integers; the query accepts true/false.
- `GET /slow` waits exactly **80 seconds**, then returns
  `{"delay_seconds":80,"status":"completed"}`. It is a duration probe, never a
  health check. Routine tests replace the sleep function; use `curl --max-time 90
http://127.0.0.1:8000/slow` only for an intentional real-duration smoke.
- Invalid input receives a framework-native 4xx response. No caller-supplied URL,
  filesystem path or code is executed. All data is disposable.

```sh
curl http://127.0.0.1:8000/health
curl -H 'Content-Type: application/json' -d '{"message":"hello","count":2}' http://127.0.0.1:8000/echo
curl 'http://127.0.0.1:8000/items/7?include_details=true'
```

## Heavy workload

Transformers.js runs real CPU ONNX models and Sharp/libvips decodes bounded images.
`/ready` lazily loads text and image services; failures return 503 and are retryable.
`/text/embedding` accepts `{"text":"hello"}` and returns model, dimension, embedding.
`/text/similarity` accepts `{"left":"hello","right":"world"}` and returns cosine similarity.
Text uses `Xenova/all-MiniLM-L6-v2`; image classification and features use
`Xenova/vit-base-patch16-224`. Model IDs and dimensions can differ from the Python
fixtures; successful JSON shapes and HTTP paths remain the same.
`/image/analyze` and `/image/embedding` accept multipart field `file`: JPEG/PNG/WebP,
at most 4 MiB and 20 million pixels. Analyze returns image width/height/format and
predictions; embedding returns model/dimension/embedding. Text is limited to 5000
characters. At most one inference request runs at a time (excess gets 429).
Health/info/echo/items remain responsive during the 80-second asynchronous sleep.

Model weights download lazily to `models/` from the public Hugging Face registry.
Normal CI installs real native dependencies but injects controlled model services.
`npm run test:model` explicitly downloads models and performs real text/image inference.
The build does not download weights and no repository install lifecycle hook runs.

## APIZIT qualification status

See the platform's [dev qualification report](https://github.com/chipsi44/APIZIT/blob/main/docs/reference-framework-dev-qualification.md)
for exact source commits, public/private launch results, release checks and
verification limits. Local tests and repository publication alone do not prove
a hosted launch. This fixture runs independently and needs no APIZIT checkout.

The measured scan and current backend commercial catalog determine launch eligibility.
No deployment profile, paid plan or production readiness is promised by this repository.

See CONTRIBUTING.md for repeatable checks.
