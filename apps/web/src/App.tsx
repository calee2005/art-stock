import { useMemo, useState } from "react";
import {
  MemoryObjectStore,
  createLibrary,
  listLibraries,
  protocolRoot,
  renameLibrary,
  type ObjectStore,
} from "@art-stock/core";
import {
  deviceIdentity,
  emptyRemoteForm,
  formToConfig,
  getManifest,
  hasCredentials,
  listProtocolKeys,
  loadRemoteForm,
  probeReadwrite,
  putWithGlobalLock,
  saveRemoteForm,
  type RemoteForm,
} from "./session.ts";

const storage: Storage = window.localStorage;
const demoStore = new MemoryObjectStore();

function activeStore(_form: RemoteForm): ObjectStore {
  // Real HTTP S3 client is still stubbed (F-002). Web uses an in-memory
  // store so list/get/locked PUT can be exercised without a backend.
  return demoStore;
}

export function App() {
  const [form, setForm] = useState<RemoteForm>(
    () => loadRemoteForm(storage) ?? emptyRemoteForm(),
  );
  const [xssDismissed, setXssDismissed] = useState(
    () => sessionStorage.getItem("art-stock.xss-ok") === "1",
  );
  const [status, setStatus] = useState("未连接。空密钥不会请求任何桶。");
  const [keys, setKeys] = useState<string[]>([]);
  const [libraries, setLibraries] = useState<{ id: string; name: string }[]>([]);
  const [newLibraryName, setNewLibraryName] = useState("");
  const device = useMemo(() => deviceIdentity(storage), []);
  const preview = useMemo(
    () => protocolRoot(form.prefix),
    [form.prefix],
  );
  const canWrite = form.mode === "readwrite";

  function update<K extends keyof RemoteForm>(key: K, value: RemoteForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function save() {
    saveRemoteForm(storage, form);
    setStatus("已保存到本机。清除站点数据会丢失密钥。");
  }

  async function probe() {
    if (!hasCredentials(form) && form.mode === "readwrite") {
      setStatus("缺少密钥，未向远端发请求。");
      return;
    }
    const result = await probeReadwrite(activeStore(form), form.prefix);
    if (!result.ok) {
      update("mode", "readonly");
      setStatus(`${result.message}。已改为只读，禁止当读写远端。`);
      return;
    }
    setStatus(`探测成功，协议根 ${result.protocolRoot}`);
  }

  async function listKeys() {
    const listed = await listProtocolKeys(activeStore(form), form.prefix);
    setKeys(listed);
    setStatus(`list ${listed.length} 个键`);
  }

  async function loadManifest() {
    const got = await getManifest(activeStore(form), form.prefix);
    setStatus(got ? `GET manifest etag ${got.etag}` : "manifest 不存在（404 可用）");
  }

  async function putSample() {
    if (!canWrite) {
      setStatus("只读模式：写入口已禁用");
      return;
    }
    const result = await putWithGlobalLock(
      activeStore(form),
      formToConfig(form),
      { deviceId: "web-local", deviceName: "web" },
      "web-sample.txt",
      "hello from web",
    );
    setStatus(
      result.lockSeenDuringPut
        ? `PUT 完成；持锁期间观察到 lock.json（token ${result.fencingToken}）`
        : "PUT 完成但未看到锁",
    );
    await listKeys();
  }

  async function refreshLibraries() {
    const listed = await listLibraries(activeStore(form), formToConfig(form).prefix);
    setLibraries(listed.map((item) => ({ id: item.id, name: item.name })));
  }

  async function onCreateLibrary() {
    if (!canWrite) {
      setStatus("只读模式：写入口已禁用");
      return;
    }
    const created = await createLibrary(
      {
        store: activeStore(form),
        prefix: formToConfig(form).prefix,
        deviceId: device.deviceId,
        deviceName: device.deviceName,
      },
      newLibraryName,
    );
    setNewLibraryName("");
    setStatus(`已创建资料库 ${created.name}`);
    await refreshLibraries();
  }

  async function onRenameLibrary(id: string, name: string) {
    if (!canWrite) {
      setStatus("只读模式：写入口已禁用");
      return;
    }
    const updated = await renameLibrary(
      {
        store: activeStore(form),
        prefix: formToConfig(form).prefix,
        deviceId: device.deviceId,
        deviceName: device.deviceName,
      },
      id,
      name,
    );
    setStatus(`已重命名为 ${updated.name}`);
    await refreshLibraries();
  }

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>Art Stock Web</h1>
      {!xssDismissed ? (
        <p role="alert" style={{ background: "#fff3cd", padding: "0.75rem" }}>
          密钥保存在浏览器本地。XSS 或不可信扩展可窃取密钥。优先使用短期密钥。
          <button
            type="button"
            onClick={() => {
              sessionStorage.setItem("art-stock.xss-ok", "1");
              setXssDismissed(true);
            }}
          >
            本会话不再提示
          </button>
        </p>
      ) : null}
      <p>
        桶内目录（可空）。Art Stock 使用 <code>{preview}</code>，不会占用该目录下其它文件。
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <label>
          名称
          <input value={form.name} onChange={(e) => update("name", e.target.value)} />
        </label>
        <label>
          endpoint
          <input value={form.endpoint} onChange={(e) => update("endpoint", e.target.value)} />
        </label>
        <label>
          bucket
          <input value={form.bucket} onChange={(e) => update("bucket", e.target.value)} />
        </label>
        <label>
          accessKeyId
          <input value={form.accessKeyId} onChange={(e) => update("accessKeyId", e.target.value)} autoComplete="off" />
        </label>
        <label>
          secretAccessKey
          <input
            type="password"
            value={form.secretAccessKey}
            onChange={(e) => update("secretAccessKey", e.target.value)}
            autoComplete="off"
          />
        </label>
        <label>
          prefix
          <input value={form.prefix} onChange={(e) => update("prefix", e.target.value)} placeholder="可空，如 art/" />
        </label>
        <label>
          <input
            type="checkbox"
            checked={form.forcePathStyle}
            onChange={(e) => update("forcePathStyle", e.target.checked)}
          />
          path-style（NAS/MinIO 通常勾选）
        </label>
        <label>
          <input
            type="checkbox"
            checked={form.mode === "readonly"}
            onChange={(e) => update("mode", e.target.checked ? "readonly" : "readwrite")}
          />
          只读
        </label>
        <button type="submit">保存</button>
      </form>
      <p>
        <a href="https://github.com/calee2005/art-stock/blob/master/docs/02-storage-protocol.md">
          CORS 需放行 If-Match / If-None-Match / x-oss-forbid-overwrite
        </a>
      </p>
      <p>
        <button type="button" onClick={() => void probe()}>
          探测条件写
        </button>
        <button type="button" onClick={() => void listKeys()}>
          List
        </button>
        <button type="button" onClick={() => void loadManifest()}>
          GET manifest
        </button>
        <button type="button" onClick={() => void putSample()} disabled={!canWrite}>
          受控 PUT
        </button>
      </p>
      <p>{status}</p>
      <ul>
        {keys.map((key) => (
          <li key={key}>{key}</li>
        ))}
      </ul>
      <h2>资料库</h2>
      <p>
        <button type="button" onClick={() => void refreshLibraries()}>
          刷新列表
        </button>
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onCreateLibrary();
        }}
      >
        <label>
          新资料库名称
          <input
            value={newLibraryName}
            onChange={(e) => setNewLibraryName(e.target.value)}
            placeholder="例如 角色设定"
          />
        </label>
        <button type="submit" disabled={!canWrite}>
          创建
        </button>
      </form>
      <ul>
        {libraries.map((lib) => (
          <li key={lib.id}>
            <input
              aria-label={`rename-${lib.id}`}
              defaultValue={lib.name}
              disabled={!canWrite}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next && next !== lib.name) {
                  void onRenameLibrary(lib.id, next);
                }
              }}
            />
            <code>{lib.id}</code>
          </li>
        ))}
      </ul>
      <style>{`
        label { display: block; margin: 0.4rem 0; }
        input[type="text"], input:not([type]), input[type="password"] { width: 100%; }
        button { margin-right: 0.5rem; min-height: 44px; }
      `}</style>
    </div>
  );
}
