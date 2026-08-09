from fastapi import FastAPI

from . import __version__
from .models import SolveRequest, SolveResponse
from .solver import SOLVER_VERSION, solve_slotting


app = FastAPI(title="GBSoft Slotting Optimizer", version=__version__)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "solverVersion": SOLVER_VERSION}


@app.post("/solve", response_model=SolveResponse)
def solve(request: SolveRequest) -> SolveResponse:
    return solve_slotting(request)
