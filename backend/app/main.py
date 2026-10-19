import os
from pathlib import Path

from fastapi import FastAPI, Response
from fastapi.responses import FileResponse
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError

VERSION = os.environ.get("APP_VERSION", "dev")
STATIC_DIR = Path(os.environ.get("STATIC_DIR", Path(__file__).parent.parent / "static"))

engine = create_engine(os.environ["DATABASE_URL"], pool_pre_ping=True)
app = FastAPI()


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
    file = STATIC_DIR / path
    if path and file.is_file():
        return FileResponse(file)
    return FileResponse(STATIC_DIR / "index.html")
