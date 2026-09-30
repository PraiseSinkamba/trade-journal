use std::path::PathBuf;
use tauri::Manager;

#[allow(dead_code)]
pub fn get_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data directory: {}", e))?;

    let data_dir = base.join("TradeJournal").join("data");

    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create data directory: {}", e))?;

    Ok(data_dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_data_dir_structure() {
        let fake = PathBuf::from("/fake/app/data");
        let result = fake.join("TradeJournal").join("data");
        assert!(result.to_str().unwrap().ends_with("TradeJournal/data"));
    }
}
