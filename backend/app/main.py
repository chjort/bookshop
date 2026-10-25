import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import FileResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app import admin, admin_orders, catalogue, logsafe, orders
from app.auth import ApiError, api_error_response
from app.db import engine

VERSION = os.environ.get("APP_VERSION", "dev")
APP_ENV = os.environ.get("APP_ENV", "local")
STATIC_DIR = Path(os.environ.get("STATIC_DIR", Path(__file__).parent.parent / "static"))

logsafe.install()
app = FastAPI()
app.add_exception_handler(ApiError, api_error_response)
app.include_router(admin.router)
app.include_router(admin_orders.router)
app.include_router(catalogue.router)
app.include_router(orders.router)


@app.get("/healthz")
def healthz(response: Response):
    try:
        with engine.connect() as conn:
            db = conn.execute(text("SELECT current_database()")).scalar_one()
    except SQLAlchemyError:
        response.status_code = 503
        return {"status": "db_unavailable", "version": VERSION, "env": APP_ENV}
    # Database name only; never the host, user, password or URL.
    return {"status": "ok", "version": VERSION, "env": APP_ENV, "db": db}


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    if path.startswith("api/"):
        raise HTTPException(404)
    root = STATIC_DIR.resolve()
    file = (root / path).resolve()
    if path and file.is_relative_to(root) and file.is_file():
        return FileResponse(file)
    return FileResponse(STATIC_DIR / "index.html")
