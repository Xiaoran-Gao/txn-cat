from fastapi import APIRouter, Query
from services.analysis import get_monthly_summary, get_trends, get_anomalies, get_monthly_spend

router = APIRouter()


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
