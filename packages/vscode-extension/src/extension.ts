import { homedir } from "node:os";
import * as vscode from "vscode";
import { findCodeceipt, repoRootOf, runCodeceipt, safePath } from "./cli";
import {
  type LastReceipt,
  type NextStep,
  type TreeRow,
  parseLast,
  parseStatus,
  statusBar,
  summary,
  tree,
} from "./model";

// Roadmap Phase 11: Codeceipt in VS Code. A status bar item (the last receipt in a few words, the next step as its
// tooltip), a small tree in the Explorer (the next step, the last receipt's counts and missed items) and four
// commands. It runs the installed `codeceipt status --json` and `codeceipt last --json` in the opened folder and
// shows what they say. No webview, no network call of its own, no token; the extension itself writes nothing (the
// command keeps its usual small records, as in a terminal). It does nothing in an untrusted workspace
// (package.json: untrustedWorkspaces not supported) and nothing in a folder that is not a git repository.

const REFRESH_MS = 5 * 60 * 1000;

type State = {
  next: NextStep | null;
  last: LastReceipt | null;
  receiptsUrl: string | null;
  problem: string | null;
};
const EMPTY: State = { next: null, last: null, receiptsUrl: null, problem: null };

class ReceiptTree implements vscode.TreeDataProvider<TreeRow> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private rows: TreeRow[] = [];

  set(rows: TreeRow[]) {
    this.rows = rows;
    this.changed.fire();
  }
  getTreeItem(row: TreeRow): vscode.TreeItem {
    const item = new vscode.TreeItem(
      row.label,
      row.children && row.children.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );
    if (row.detail) item.description = row.detail;
    // Plain text only: tooltips are strings, never Markdown.
    item.tooltip = row.detail ? `${row.label}: ${row.detail}` : row.label;
    return item;
  }
  getChildren(row?: TreeRow): TreeRow[] {
    return row ? (row.children ?? []) : this.rows;
  }
}

async function load(): Promise<State> {
  if (!vscode.workspace.isTrusted) return EMPTY;
  const folders = (vscode.workspace.workspaceFolders ?? [])
    .filter((f) => f.uri.scheme === "file")
    .map((f) => f.uri.fsPath);
  const cwd = folders[0];
  if (!cwd) return EMPTY;
  if (!repoRootOf(cwd)) return EMPTY;
  const bin = findCodeceipt(process.env, homedir(), process.platform, folders);
  if (!bin) {
    return {
      ...EMPTY,
      problem: "Codeceipt is not installed on this computer. See the quickstart to install it.",
    };
  }
  const path = safePath(process.env, process.platform, folders);
  const [status, last] = await Promise.all([
    runCodeceipt(bin, ["status", "--json"], cwd, path),
    runCodeceipt(bin, ["last", "--json"], cwd, path),
  ]);
  if (!status.ok && !last.ok) {
    return {
      ...EMPTY,
      problem: "This folder is not connected to Codeceipt yet. Run `npx codeceipt` in a terminal.",
    };
  }
  const parsedLast = last.ok ? parseLast(last.json) : { receipt: null, url: null };
  return {
    next: status.ok ? parseStatus(status.json) : null,
    last: parsedLast.receipt,
    receiptsUrl: parsedLast.url,
    problem: null,
  };
}

export function activate(context: vscode.ExtensionContext): void {
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  bar.command = "codeceipt.showLast";
  const view = new ReceiptTree();
  let state: State = EMPTY;
  let running = false;

  const refresh = async () => {
    // One refresh at a time: a slow command is never started twice.
    if (running) return;
    running = true;
    try {
      state = await load();
      const { text, tooltip } = statusBar(state.next, state.last);
      bar.text = text;
      bar.tooltip = state.problem ?? tooltip;
      view.set(tree(state.next, state.last));
      bar.show();
    } finally {
      running = false;
    }
  };
  const open = (url: string | null) => {
    if (url) void vscode.env.openExternal(vscode.Uri.parse(url, true));
    else
      void vscode.window.showInformationMessage(
        state.problem ?? "Codeceipt has no page to open for this folder yet.",
      );
  };

  context.subscriptions.push(
    bar,
    vscode.window.registerTreeDataProvider("codeceipt.receipt", view),
    vscode.commands.registerCommand("codeceipt.refresh", refresh),
    vscode.commands.registerCommand("codeceipt.openReceipts", () => open(state.receiptsUrl)),
    vscode.commands.registerCommand("codeceipt.openNext", () => open(state.next?.url ?? null)),
    vscode.commands.registerCommand("codeceipt.showLast", async () => {
      await refresh();
      if (state.problem) {
        void vscode.window.showInformationMessage(state.problem);
        return;
      }
      const pick = await vscode.window.showInformationMessage(
        summary(state.next, state.last),
        ...(state.receiptsUrl ? ["Open receipts"] : []),
      );
      if (pick === "Open receipts") open(state.receiptsUrl);
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(refresh),
    vscode.workspace.onDidChangeWorkspaceFolders(refresh),
  );
  const timer = setInterval(refresh, REFRESH_MS);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  void refresh();
}

export function deactivate(): void {}
