from fastapi import APIRouter
from models import NLQueryRequest
from services.nl_query import execute_nl_query

router = APIRouter()


@router.post("")
def natural_language_query(req: NLQueryRequest):
    return execute_nl_query(req.question)
