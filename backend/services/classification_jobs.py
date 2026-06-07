from datetime import datetime
from threading import Lock
from uuid import uuid4

from services.categorizer import categorize_batch


_jobs: dict[str, dict] = {}
_lock = Lock()


def create_classification_job(txn_ids: list[int], source: str = "manual") -> dict:
    job_id = uuid4().hex
    unique_ids = list(dict.fromkeys(txn_ids))
    job = {
        "id": job_id,
        "source": source,
        "status": "queued",
        "total": len(unique_ids),
        "processed": 0,
        "categorized": 0,
        "failed": 0,
        "message": "等待开始分类",
        "error": None,
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
        "txn_ids": unique_ids,
    }
    with _lock:
        _jobs[job_id] = job
    return public_job(job)


def public_job(job: dict) -> dict:
    return {key: value for key, value in job.items() if key != "txn_ids"}


def get_classification_job(job_id: str) -> dict | None:
    with _lock:
        job = _jobs.get(job_id)
        return public_job(job) if job else None


def _update_job(job_id: str, **updates) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            return
        job.update(updates)
        job["updated_at"] = datetime.now().isoformat()


def run_classification_job(job_id: str) -> None:
    with _lock:
        job = _jobs.get(job_id)
        txn_ids = list(job["txn_ids"]) if job else []

    if not job:
        return
    if not txn_ids:
        _update_job(job_id, status="done", message="没有待分类交易")
        return

    _update_job(job_id, status="running", message="正在调用本地 LLM 分类")

    def on_progress(progress: dict) -> None:
        processed = int(progress.get("processed", 0))
        total = int(progress.get("total", len(txn_ids)))
        error = progress.get("error")
        _update_job(
            job_id,
            processed=processed,
            total=total,
            categorized=int(progress.get("categorized", 0)),
            failed=int(progress.get("failed", 0)),
            message=progress.get("message") or (f"正在分类 {processed}/{total}" if not error else f"分类失败：{error}"),
            error=error,
        )

    try:
        result = categorize_batch(txn_ids, progress_callback=on_progress)
        finished_status = "failed" if result.get("error") and result["failed"] == result["total"] else "done"
        _update_job(
            job_id,
            status=finished_status,
            processed=result["total"],
            total=result["total"],
            categorized=result["categorized"],
            failed=result["failed"],
            error=result.get("error"),
            message="分类完成" if not result.get("error") else f"分类失败：{result['error']}",
        )
    except Exception as exc:
        _update_job(
            job_id,
            status="failed",
            error=str(exc),
            message="分类任务失败",
        )
