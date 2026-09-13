import { listenS3Mock } from "./mock-http.ts";

const port = Number(process.env.S3_MOCK_PORT ?? "19001");
const bucket = process.env.S3_MOCK_BUCKET ?? "art";
const accessKeyId = process.env.S3_MOCK_ACCESS_KEY_ID ?? "AKIATEST";

const mock = await listenS3Mock({ port, bucket, accessKeyId });
console.log(`s3-mock ${mock.url} bucket=${bucket}`);

const shutdown = async () => {
  await mock.close();
  process.exit(0);
};
process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
