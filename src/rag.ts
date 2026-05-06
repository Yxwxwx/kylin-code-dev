import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import OpenAI from "openai";
import chalk from "chalk";

interface Chunk {
  id: number;
  file: string;
  content: string;
  embedding: number[];
}
interface Index {
  chunks: Chunk[];
  builtAt: string;
  docHash: string;
}

const CHUNK_SIZE = 800,
  CHUNK_OVERLAP = 100;

function fileTags(relPath: string): string[] {
  const tags: string[] = [],
    parts = relPath.split("/");
  for (let i = 0; i < parts.length - 1; i++) {
    const d = parts[i]!;
    if (d && d !== "examples" && d !== "user") tags.push(d);
  }
  const fn = parts[parts.length - 1]!.replace(/\.[^.]+$/, "");
  tags.push(
    ...fn
      .replace(/^\d+-?/, "")
      .split(/[-_]/)
      .filter((w) => w.length > 0 && !/^\d+$/.test(w)),
  );
  return [...new Set(tags)];
}

function chunkFile(rp: string, c: string): Chunk[] {
  const ext = path.extname(rp),
    chunks: Chunk[] = [],
    tags = fileTags(rp);
  const ts = tags.length > 0 ? `[tags: ${tags.join(", ")}]\n` : "";
  const add = (t: string) =>
    chunks.push({ id: 0, file: rp, content: ts + t, embedding: [] });
  if (ext === ".rst") {
    for (const s of c.split(/\n(?=[=\-~^"]{3,}\n)/)) {
      const cl = s.replace(/^[=\-~^"]+\n?/gm, "").trim();
      if (cl.length < 10) continue;
      if (cl.length > CHUNK_SIZE + CHUNK_OVERLAP)
        for (let i = 0; i < cl.length; i += CHUNK_SIZE - CHUNK_OVERLAP)
          add(cl.slice(i, i + CHUNK_SIZE).trim());
      else add(cl);
    }
  } else if (ext === ".md" || ext === ".txt") {
    for (const s of c.split(/(?=^#{1,3}\s)/m)) {
      const cl = s.trim();
      if (cl.length < 10) continue;
      if (cl.length > CHUNK_SIZE + CHUNK_OVERLAP)
        for (let i = 0; i < cl.length; i += CHUNK_SIZE - CHUNK_OVERLAP)
          add(cl.slice(i, i + CHUNK_SIZE).trim());
      else add(cl);
    }
  } else {
    const bl = c.split(/\n(?=def |class |async def |# |## )/);
    let cur = "";
    for (const b of bl) {
      if (cur.length + b.length > CHUNK_SIZE && cur.length > 100) {
        add(cur.trim());
        cur = b;
      } else cur += (cur ? "\n" : "") + b;
    }
    if (cur.trim()) add(cur.trim());
  }
  return chunks.map((x) => ({ ...x, content: `[${rp}]\n${x.content}` }));
}

function docsHash(d: string): string {
  const h = crypto.createHash("md5");
  (function w(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) w(fp);
      else h.update(e.name + fs.statSync(fp).mtimeMs);
    }
  })(d);
  return h.digest("hex");
}

function cosine(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function embedWith(k: string) {
  const cl = new OpenAI({
    apiKey: k,
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  });
  return async (ts: string[]): Promise<number[][]> => {
    for (let a = 0; a < 3; a++) {
      try {
        const r = await cl.embeddings.create({
          model: "text-embedding-v4",
          input: ts,
          dimensions: 1024,
        });
        return r.data.map((d) => d.embedding);
      } catch (e: any) {
        if (String(e).match(/429|Throttling|Rate/)) {
          await new Promise((r) => setTimeout(r, (a + 1) * 2000));
          continue;
        }
        throw e;
      }
    }
    throw new Error("embedding 重试耗尽");
  };
}

function log(m: string) {
  console.log(chalk.gray(`  [RAG] ${m}`));
}

async function buildIndex(dd: string, ak: string): Promise<Index> {
  const em = embedWith(ak),
    ac: Chunk[] = [];
  (function w(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) {
        w(fp);
        continue;
      }
      if (![".py", ".md", ".rst", ".txt"].includes(path.extname(e.name)))
        continue;
      try {
        ac.push(
          ...chunkFile(path.relative(dd, fp), fs.readFileSync(fp, "utf-8")),
        );
      } catch {}
    }
  })(dd);
  log(`文档分块完成: ${ac.length} chunks`);
  const B = 10,
    CC = 10,
    st = Date.now();
  for (let i = 0; i < ac.length; i += B * CC) {
    const js: Promise<void>[] = [];
    for (let j = 0; j < CC && i + j * B < ac.length; j++) {
      const bt = ac.slice(i + j * B, i + (j + 1) * B);
      js.push(
        em(bt.map((c) => c.content)).then((es) =>
          bt.forEach((c, k) => (c.embedding = es[k]!)),
        ),
      );
    }
    await Promise.all(js);
    log(`embedding 进度: ${Math.min(i + B * CC, ac.length)}/${ac.length}`);
  }
  const vd = ac.filter((c) => c.embedding.length > 0);
  vd.forEach((c, i) => (c.id = i));
  log(
    `索引构建完成: ${vd.length} chunks, ${((Date.now() - st) / 1000).toFixed(1)}s`,
  );
  return {
    chunks: vd,
    builtAt: new Date().toISOString(),
    docHash: docsHash(dd),
  };
}

function cachePath(dd: string): string {
  return path.join(
    dd,
    "..",
    `.pyscf-index-${crypto.createHash("md5").update(dd).digest("hex").slice(0, 12)}.json`,
  );
}

async function ensureIndex(dd: string, ak: string): Promise<Index> {
  const cp = cachePath(dd),
    ch = docsHash(dd);
  if (fs.existsSync(cp)) {
    try {
      const ca: Index = JSON.parse(fs.readFileSync(cp, "utf-8"));
      if (ca.docHash === ch && ca.chunks.length > 0) {
        log(`索引缓存命中: ${ca.chunks.length} chunks`);
        return ca;
      }
    } catch {}
  }
  log("开始构建索引...");
  const ix = await buildIndex(dd, ak);
  try {
    fs.writeFileSync(cp, JSON.stringify(ix));
  } catch {}
  return ix;
}

const KW_MAP: Record<string, string[]> = {
  scf: [
    "scf",
    "hf",
    "rhf",
    "uhf",
    "rohf",
    "hartree-fock",
    "自洽场",
    "基态能量",
    "单点能",
  ],
  dft: ["dft", "b3lyp", "pbe0", "m06", "wb97", "cam-b3lyp", "密度泛函"],
  uks: ["uks", "unrestricted", "开壳层", "非限制"],
  stability: [
    "stability",
    "stable",
    "internal",
    "稳定性",
    "稳定",
    "波函数稳定",
  ],
  cc: [
    "cc",
    "ccd",
    "ccsd",
    "ccsd(t)",
    "ccsdt",
    "ccsdt(q)",
    "cc2",
    "cc3",
    "coupled cluster",
    "耦合簇",
  ],
  mp: ["mp2", "mp3", "mp4", "微扰"],
  ci: ["fci", "cisd", "full ci", "组态相互作用", "全组态"],
  mcscf: [
    "mcscf",
    "casscf",
    "casci",
    "caspt2",
    "多组态",
    "多参考",
    "活性空间",
    "active space",
  ],
  mrpt: ["mrpt", "nevpt2", "caspt2", "多参考微扰"],
  tddft: [
    "tddft",
    "tda",
    "tdhf",
    "激发态",
    "excited state",
    "吸收光谱",
    "uv-vis",
  ],
  optimize: [
    "optimize",
    "optimization",
    "geomopt",
    "opt",
    "结构优化",
    "优化",
    "构型优化",
  ],
  hessian: [
    "hessian",
    "frequency",
    "freq",
    "vibration",
    "ir",
    "raman",
    "频率",
    "振动",
    "红外",
    "热化学",
  ],
  gradient: ["gradient", "grad", "梯度", "力"],
  basis: [
    "basis",
    "basisset",
    "基组",
    "cc-pv",
    "def2",
    "sto-3g",
    "6-31g",
    "aug-cc",
  ],
  gto: [
    "gto",
    "mole",
    "atom",
    "分子",
    "坐标",
    "geometry",
    "结构",
    "键长",
    "键角",
  ],
  solvent: ["solvent", "pcm", "smd", "cosmo", "溶剂", "溶剂化", "水溶液"],
  x2c: ["x2c", "relativistic", "相对论", "旋轨耦合", "spin-orbit", "dkh"],
  df: ["density fitting", "df", "ri", "密度拟合", "辅助基组"],
  pbc: [
    "pbc",
    "periodic",
    "crystal",
    "solid",
    "k-point",
    "周期性",
    "晶体",
    "固体",
    "能带",
  ],
  qmmm: ["qmmm", "qm/mm", "embedding", "嵌入"],
  gw: ["gw"],
  adc: ["adc"],
  agf2: ["agf2"],
  eph: ["eph", "electron-phonon", "电子声子"],
  nmr: ["nmr", "核磁", "chemical shift", "化学位移", "shielding"],
  nac: ["nac", "nonadiabatic", "非绝热"],
  md: ["md", "molecular dynamics", "分子动力学"],
  mcpdft: ["mcpdft", "mc-pdft"],
  sgx: ["sgx"],
  symmetry: ["symm", "symmetry", "对称性", "点群"],
  avas: ["avas", "atomic valence"],
  localorb: ["local_orb", "localized", "ibo", "pmo", "局域化", "定域化"],
  ao2mo: ["ao2mo", "integral transform", "积分变换"],
  mpi: ["mpi", "parallel", "并行"],
};

// 领域门控：查询未涉及该领域关键词，降权 -0.25
const DOMAIN_GATE: Record<string, string[]> = {
  "examples/pbc": [
    "pbc",
    "periodic",
    "crystal",
    "solid",
    "k-point",
    "周期性",
    "晶体",
    "固体",
    "能带",
  ],
  "user/pbc": [
    "pbc",
    "periodic",
    "crystal",
    "solid",
    "k-point",
    "周期性",
    "晶体",
    "固体",
    "能带",
  ],
  "examples/solvent": [
    "solvent",
    "pcm",
    "smd",
    "cosmo",
    "溶剂",
    "溶剂化",
    "水溶液",
  ],
  "user/solvent": [
    "solvent",
    "pcm",
    "smd",
    "cosmo",
    "溶剂",
    "溶剂化",
    "水溶液",
  ],
  "examples/qmmm": ["qmmm", "qm/mm", "embedding", "嵌入"],
  "examples/md": ["md", "molecular dynamics", "分子动力学"],
  "examples/nmr": ["nmr", "核磁", "chemical shift"],
  "examples/nac": ["nac", "nonadiabatic", "非绝热"],
  "examples/x2c": ["x2c", "relativistic", "相对论", "旋轨耦合", "spin-orbit"],
  "user/x2c": ["x2c", "relativistic", "相对论", "旋轨耦合", "spin-orbit"],
  "examples/gw": ["gw"],
  "user/gw": ["gw"],
  "examples/local_orb": [
    "local_orb",
    "localized",
    "ibo",
    "pmo",
    "局域化",
    "定域化",
  ],
  "examples/df": ["density fitting", "df", "ri", "密度拟合", "辅助基组"],
  "user/df": ["density fitting", "df", "ri", "密度拟合", "辅助基组"],
  "examples/eph": ["eph", "electron-phonon", "电子声子"],
  "user/eph": ["eph", "electron-phonon", "电子声子"],
  "examples/sgx": ["sgx"],
  "examples/ao2mo": ["ao2mo", "integral transform", "积分变换"],
  "examples/agf2": ["agf2"],
  "examples/adc": ["adc"],
  "examples/mpi": ["mpi", "parallel", "并行"],
  "examples/symm": ["symm", "symmetry", "对称性", "点群"],
  "examples/tools": [],
  "examples/misc": [],
  "examples/1-advanced": [],
  "examples/2-benchmark": [],
};

function keywordBoost(q: string, c: string, f: string): number {
  const ql = q.toLowerCase(),
    cl = c.toLowerCase(),
    fl = f.toLowerCase();
  let b = 0;
  for (const ts of Object.values(KW_MAP)) {
    if (ts.some((t) => ql.includes(t)) && ts.some((t) => cl.includes(t)))
      b += 0.04;
  }
  for (const w of fl
    .replace(/[^a-z0-9]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2)) {
    if (ql.includes(w)) b += 0.03;
  }
  return Math.min(0.2, b);
}

function domainPenalty(q: string, f: string): number {
  const ql = q.toLowerCase();
  for (const [pf, ts] of Object.entries(DOMAIN_GATE)) {
    if (f.startsWith(pf) && !ts.some((t) => ql.includes(t))) return -0.25;
  }
  return 0;
}

function translateQuery(cn: string): string {
  let o = cn;
  for (const ts of Object.values(KW_MAP)) {
    const en = ts[0]!;
    for (const t of ts) {
      if (/[\u4e00-\u9fff]/.test(t) && o.includes(t))
        o = o.replace(new RegExp(t, "g"), en);
    }
  }
  return o;
}

export async function queryDocs(
  dd: string,
  q: string,
  ak: string,
  topK = 8,
): Promise<{ content: string; file: string; score: number }[]> {
  if (!ak) {
    log("DashScope API Key 未设置，跳过 RAG");
    return [];
  }
  const ix = await ensureIndex(dd, ak);
  if (ix.chunks.length === 0) {
    log("索引为空，跳过 RAG");
    return [];
  }
  const eq = translateQuery(q);
  if (eq !== q) log(`查询翻译: ${eq}`);
  const em = embedWith(ak),
    qe = await em([eq]),
    qv = qe[0]!;
  const sc = ix.chunks.map((c) => ({
    content: c.content,
    file: c.file,
    score:
      cosine(qv, c.embedding) +
      keywordBoost(q, c.content, c.file) +
      domainPenalty(q, c.file),
  }));
  sc.sort((a, b) => b.score - a.score);
  const sn = new Set<string>(),
    dd2: typeof sc = [];
  for (const r of sc) {
    if (sn.has(r.file)) continue;
    sn.add(r.file);
    dd2.push(r);
    if (dd2.length >= topK) break;
  }
  log(`检索完成 (top-${dd2.length}):`);
  dd2.forEach((r, i) =>
    log(`  ${i + 1}. ${chalk.cyan(r.file)} (${r.score.toFixed(3)})`),
  );
  return dd2;
}

export async function rebuildIndex(dd: string, ak: string): Promise<void> {
  try {
    fs.unlinkSync(cachePath(dd));
  } catch {}
  await ensureIndex(dd, ak);
}
