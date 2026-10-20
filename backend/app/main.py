import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import FileResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app import admin, catalogue, logsafe, orders
from app.db import engine

VERSION = os.environ.get("APP_VERSION", "dev")
STATIC_DIR = Path(os.environ.get("STATIC_DIR", Path(__file__).parent.parent / "static"))

logsafe.install()
app = FastAPI()
app.include_router(admin.router)
app.include_router(catalogue.router)
app.include_router(orders.router)


@app.get("/healthz")
def healthz(response: Response):
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except SQLAlchemyError:
        response.status_code = 503
        return {"status": "db_unavailable", "version": VERSION}
    return {"status": "ok", "version": VERSION}


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    if path.startswith("api/"):
        raise HTTPException(404)
    root = STATIC_DIR.resolve()
    file = (root / path).resolve()
    if path and file.is_relative_to(root) and file.is_file():
        return FileResponse(file)
    return FileResponse(STATIC_DIR / "index.html")
