"""Registration, login, and the current user."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import AuditEntry, User, get_db
from ..schemas import Token, UserCreate, UserOut
from ..security import (
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
async def register(payload: UserCreate, db: AsyncSession = Depends(get_db)) -> Token:
    email = payload.email.lower().strip()

    existing = (
        await db.execute(select(User).where(User.email == email))
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists. Sign in instead.",
        )

    try:
        hashed = hash_password(payload.password)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc

    user = User(email=email, hashed_password=hashed, full_name=payload.full_name.strip())
    db.add(user)
    await db.flush()
    db.add(AuditEntry(user_id=user.id, action="user_registered", detail={"email": email}))
    await db.commit()
    await db.refresh(user)

    return Token(
        access_token=create_access_token(user.id), user=UserOut.model_validate(user)
    )


@router.post("/login", response_model=Token)
async def login(
    form: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)
) -> Token:
    email = form.username.lower().strip()
    user = (
        await db.execute(select(User).where(User.email == email))
    ).scalar_one_or_none()

    # Same message for unknown account and wrong password — distinguishing them
    # tells an attacker which emails are registered.
    if user is None or not verify_password(form.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="This account is disabled."
        )

    db.add(AuditEntry(user_id=user.id, action="user_login", detail={}))
    await db.commit()

    return Token(
        access_token=create_access_token(user.id), user=UserOut.model_validate(user)
    )


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)
