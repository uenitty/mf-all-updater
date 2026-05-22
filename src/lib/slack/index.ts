import * as v from "valibot";

type UploadFileParams = {
  filename: string;
  buffer: Buffer;
  channelId: string;
  initialComment: string;
  botToken: string;
};

const GetUploadUrlResponseSchema = v.variant("ok", [
  v.object({
    ok: v.literal(true),
    upload_url: v.string(),
    file_id: v.string(),
  }),
  v.object({
    ok: v.literal(false),
    error: v.string(),
  }),
]);

const CompleteUploadResponseSchema = v.variant("ok", [
  v.object({ ok: v.literal(true) }),
  v.object({
    ok: v.literal(false),
    error: v.string(),
  }),
]);

async function uploadFile({
  filename,
  buffer,
  channelId,
  initialComment,
  botToken,
}: UploadFileParams): Promise<void> {
  const getUploadUrlResponse = await fetch(
    "https://slack.com/api/files.getUploadURLExternal",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      },
      body: new URLSearchParams({
        filename,
        length: buffer.length.toString(),
      }),
    },
  );
  if (!getUploadUrlResponse.ok) {
    throw new Error(
      `Slack files.getUploadURLExternal request failed: ${getUploadUrlResponse.status} ${getUploadUrlResponse.statusText}`,
    );
  }
  const uploadUrlData = v.parse(
    GetUploadUrlResponseSchema,
    await getUploadUrlResponse.json(),
  );
  if (!uploadUrlData.ok) {
    throw new Error(`Failed to get upload URL: ${uploadUrlData.error}`);
  }

  const uploadResponse = await fetch(uploadUrlData.upload_url, {
    method: "POST",
    body: new Blob([Uint8Array.from(buffer)]),
  });
  if (!uploadResponse.ok) {
    throw new Error(
      `Slack file upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`,
    );
  }

  const completeUploadResponse = await fetch(
    "https://slack.com/api/files.completeUploadExternal",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        files: [{ id: uploadUrlData.file_id, title: filename }],
        channel_id: channelId,
        initial_comment: initialComment,
      }),
    },
  );
  if (!completeUploadResponse.ok) {
    throw new Error(
      `Slack files.completeUploadExternal request failed: ${completeUploadResponse.status} ${completeUploadResponse.statusText}`,
    );
  }
  const completeUploadData = v.parse(
    CompleteUploadResponseSchema,
    await completeUploadResponse.json(),
  );
  if (!completeUploadData.ok) {
    throw new Error(`Failed to complete upload: ${completeUploadData.error}`);
  }
}

export const files = {
  upload: uploadFile,
};
