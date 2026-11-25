use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Serialize)]
pub struct GitCommit {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub author_email: String,
    pub committed_at: String,
    pub committed_offset: String,
    pub branch: String,
}

#[derive(Serialize)]
pub struct GitCollectResult {
    pub is_git: bool,
    pub repo_remote: Option<String>,
    pub branch: Option<String>,
    pub commits: Vec<GitCommit>,
    pub error: Option<String>,
}

/// 检查目录是否为 git 仓库
fn is_git_repo(dir: &str) -> bool {
    Command::new("git")
        .args(["rev-parse", "--is-inside-work-tree"])
        .current_dir(dir)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// 用 git log 采集提交元数据（增量：可传 since_hash 跳过已传提交）
fn collect_commits(dir: &str, since_hash: Option<&str>) -> Vec<GitCommit> {
    // 分隔符用 \x1e (RS)，字段间用 \x1f (US)，避免与提交内容冲突
    let mut args = vec![
        "log".to_string(),
        "--all".to_string(),
        format!("--pretty=format:%H%x1f%an%x1f%ae%x1f%aI%x1f%ad%x1f%x1e%s"),
    ];
    if let Some(h) = since_hash {
        args.push(format!("{h}..HEAD"));
    }
    let out = Command::new("git")
        .args(&args)
        .current_dir(dir)
        .output()
        .expect("git log failed");
    if !out.status.success() {
        return Vec::new();
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut commits = Vec::new();
    for record in text.split('\x1e') {
        let record = record.trim();
        if record.is_empty() {
            continue;
        }
        let fields: Vec<&str> = record.split('\x1f').collect();
        if fields.len() < 6 {
            continue;
        }
        commits.push(GitCommit {
            hash: fields[0].to_string(),
            author: fields[1].to_string(),
            author_email: fields[2].to_string(),
            committed_at: fields[3].to_string(),
            committed_offset: String::new(), // 由前端按需解析
            branch: String::new(),           // 单独查询
            message: fields[5].to_string(),
        });
    }
    commits
}

/// 获取当前分支名
fn current_branch(dir: &str) -> Option<String> {
    Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(dir)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
}

/// 获取 remote URL（首个 origin 或任意 remote）
fn remote_url(dir: &str) -> Option<String> {
    let out = Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(dir)
        .output()
        .ok();
    if let Some(o) = out {
        if o.status.success() {
            return Some(String::from_utf8_lossy(&o.stdout).trim().to_string());
        }
    }
    // fallback：任意 remote
    let remotes = Command::new("git")
        .args(["remote"])
        .current_dir(dir)
        .output()
        .ok();
    if let Some(o) = remotes {
        if o.status.success() {
            let text = String::from_utf8_lossy(&o.stdout);
            let name = text.lines().next().map(|s| s.to_string());
            if let Some(n) = name {
                let url = Command::new("git")
                    .args(["remote", "get-url", &n])
                    .current_dir(dir)
                    .output()
                    .ok();
                if let Some(u) = url {
                    if u.status.success() {
                        return Some(String::from_utf8_lossy(&u.stdout).trim().to_string());
                    }
                }
            }
        }
    }
    None
}

/// 采集一个本地目录的 git 元数据（v1：全量；since_hash 留作 v2 增量）
#[tauri::command]
fn git_collect(dir: String, since_hash: Option<String>) -> GitCollectResult {
    let d = Path::new(&dir);
    if !d.exists() {
        return GitCollectResult {
            is_git: false,
            repo_remote: None,
            branch: None,
            commits: Vec::new(),
            error: Some("目录不存在".into()),
        };
    }
    if !is_git_repo(&dir) {
        return GitCollectResult {
            is_git: false,
            repo_remote: None,
            branch: None,
            commits: Vec::new(),
            error: Some("不是 git 仓库".into()),
        };
    }
    let mut commits = collect_commits(&dir, since_hash.as_deref());
    let branch = current_branch(&dir);
    for c in commits.iter_mut() {
        c.branch = branch.clone().unwrap_or_default();
        c.committed_offset = String::new();
    }
    GitCollectResult {
        is_git: true,
        repo_remote: remote_url(&dir),
        branch,
        commits,
        error: None,
    }
}

/// 打开目录选择对话框
#[tauri::command]
async fn select_dir(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let file_path = app.dialog().file().blocking_pick_folder();
    file_path.map(|p| p.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![git_collect, select_dir])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}