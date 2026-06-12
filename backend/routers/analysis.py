from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from services.analysis import (
    generate_monthly_narrative,
    get_anomalies,
    get_monthly_spend,
    get_monthly_summary,
    get_trends,
)

router = APIRouter()


class MonthlyNarrativeRequest(BaseModel):
    analytics: dict = Field(default_factory=dict)


@router.get("/summary")
def summary(month: str = Query(..., description="YYYY-MM")):
    return get_monthly_summary(month)


@router.get("/trends")
def trends(months: int = Query(12, ge=3, le=36)):
    return get_trends(months)


@router.get("/anomalies")
def anomalies(month: str = Query(..., description="YYYY-MM")):
    return get_anomalies(month)


@router.get("/monthly-spend")
def monthly_spend(months: int = Query(12, ge=3, le=36)):
    return get_monthly_spend(months)


@router.post("/monthly-summary")
def monthly_summary(payload: MonthlyNarrativeRequest):
    return generate_monthly_narrative(payload.analytics)
