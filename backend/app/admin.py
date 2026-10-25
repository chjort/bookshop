from fastapi import APIRouter, Depends, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy import text

from app import csv_import
from app.auth import (
    COOKIE,
    SESSION_SECONDS,
    check_credentials,
    make_session,
    require_admin,
    require_json,
)
from app.db import engine

MAX_BYTES = 5 * 1024 * 1024
LOGIN_ERROR = "Wrong username or password."

router = APIRouter(prefix="/api/admin")


class LoginIn(BaseModel):
    username: str
    password: str


@router.post("/login", dependencies=[Depends(require_json)])
def login(body: LoginIn, response: Response):
    result = check_credentials(body.username, body.password)
    if result != "ok":
        raise HTTPException(429 if result == "locked" else 401, LOGIN_ERROR)
    response.set_cookie(
        COOKIE,
        make_session(body.username),
        max_age=SESSION_SECONDS,
        httponly=True,
        secure=True,
        samesite="lax",
        path="/",
    )
    return {"username": body.username}


@router.post("/logout", dependencies=[Depends(require_json)])
def logout(response: Response):
    response.delete_cookie(COOKIE, path="/", httponly=True, secure=True, samesite="lax")
    return {}


@router.get("/me")
def me(username: str = Depends(require_admin)):
    return {"username": username}


@router.get("/catalogue", dependencies=[Depends(require_admin)])
def catalogue():
    with engine.connect() as conn:
        count, last = conn.execute(text("SELECT count(*), max(updated_at) FROM books")).one()
    return {"books": count, "last_import": last}


@router.post("/import", dependencies=[Depends(require_admin)])
async def import_csv(request: Request, file: UploadFile):
    if request.headers.get("x-requested-with") != "bookshop":
        raise HTTPException(403, "Missing X-Requested-With header")
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "The file is too large. The maximum is 5 MB.")
    try:
        books, errors = csv_import.parse(data)
    except csv_import.FileError as e:
        raise HTTPException(422, str(e)) from None
    with engine.begin() as conn:
        created, updated = csv_import.save(conn, books)
    return {"created": created, "updated": updated, "skipped": len(errors), "errors": errors}
