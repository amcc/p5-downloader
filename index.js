import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";

const USERNAME = "amcc";
const PROJECT_DIR = "projects";

// -----------------------------
// UTILS
// -----------------------------
const sanitize = (name) => {
  if (!name) return "untitled";
  return String(name)
    .replace(/[<>:"/\\|?*]+/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 120);
};

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJSON(filePath) {
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw);
}

// -----------------------------
// FETCH PROJECTS
// -----------------------------
async function getProjects() {
  const res = await fetch(
    `https://editor.p5js.org/editor/${USERNAME}/projects`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
      },
    },
  );

  const data = await res.json();
  return data.projects;
}

// -----------------------------
// WRITE FILE TREE
// -----------------------------
async function writeTree(files, folder) {
  const map = new Map(files.map((f) => [f.id, f]));

  const root = files.find((f) => f.name === "root");
  if (!root) return;

  async function walk(node, currentPath) {
    if (!node) return;

    if (node.fileType === "folder") {
      const dir =
        node.name === "root"
          ? currentPath
          : path.join(currentPath, sanitize(node.name));

      await fs.mkdir(dir, { recursive: true });

      for (const id of node.children || []) {
        await walk(map.get(id), dir);
      }
    }

    if (node.fileType === "file") {
      const filePath = path.join(currentPath, node.name);
      await fs.writeFile(filePath, node.content || "");
    }
  }

  await walk(root, folder);
}

// -----------------------------
// MAIN SYNC LOOP
// -----------------------------
(async () => {
  const projects = await getProjects();

  console.log(`Found ${projects.length} projects\n`);

  let stats = {
    new: 0,
    updated: 0,
    skipped: 0,
  };

  for (const p of projects) {
    const name = sanitize(p.name || p.id);
    const folder = path.join(PROJECT_DIR, name);
    const marker = path.join(folder, "project.json");

    let shouldUpdate = true;

    // -----------------------------
    // CHECK EXISTING PROJECT
    // -----------------------------
    if (await fileExists(marker)) {
      const existing = await readJSON(marker);

      if (existing.updatedAt === p.updatedAt) {
        console.log("⏭ unchanged:", name);
        stats.skipped++;
        continue;
      }

      console.log("🔄 updated:", name);
      stats.updated++;
    } else {
      console.log("📦 new:", name);
      stats.new++;
    }

    // -----------------------------
    // WRITE PROJECT
    // -----------------------------
    await fs.mkdir(folder, { recursive: true });

    await writeTree(p.files, folder);

    await fs.writeFile(
      marker,
      JSON.stringify(
        {
          ...p,
          _syncedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  }

  // -----------------------------
  // SUMMARY
  // -----------------------------
  console.log("\n📊 SUMMARY");
  console.log("New:", stats.new);
  console.log("Updated:", stats.updated);
  console.log("Skipped:", stats.skipped);

  // -----------------------------
  // OPTIONAL GIT AUTO-COMMIT
  // -----------------------------
  try {
    execSync("git add .");

    if (stats.new || stats.updated) {
      execSync(
        `git commit -m "sync: ${stats.new} new, ${stats.updated} updated"`,
      );
      execSync("git push");
      console.log("\n🚀 git pushed");
    } else {
      console.log("\n✔ no git changes");
    }
  } catch (e) {
    console.log("\n⚠ git step skipped or failed");
  }

  console.log("\n✅ sync complete");
})();
