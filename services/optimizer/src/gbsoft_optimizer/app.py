from fastapi import FastAPI

from . import __version__
from .models import SolveRequest, SolveResponse
from .pallet import PalletizeRequest, PalletizeResponse, solve_palletize
from .pallet import SOLVER_VERSION as PALLET_SOLVER_VERSION
from .picktour import PickTourRequest, PickTourResponse, solve_pick_tour
from .picktour import SOLVER_VERSION as PICK_TOUR_SOLVER_VERSION
from .solver import SOLVER_VERSION, solve_slotting


app = FastAPI(title="GBSoft Slotting Optimizer", version=__version__)


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "solverVersion": SOLVER_VERSION,
        "pickTourSolverVersion": PICK_TOUR_SOLVER_VERSION,
        "palletSolverVersion": PALLET_SOLVER_VERSION,
    }


@app.post("/solve", response_model=SolveResponse)
def solve(request: SolveRequest) -> SolveResponse:
    return solve_slotting(request)


@app.post("/solve/pick-tour", response_model=PickTourResponse)
def solve_tour(request: PickTourRequest) -> PickTourResponse:
    return solve_pick_tour(request)


@app.post("/solve/pallet", response_model=PalletizeResponse)
def solve_pallet(request: PalletizeRequest) -> PalletizeResponse:
    return solve_palletize(request)
