import { Router, type IRouter } from "express";
import healthRouter from "./health";
import derivRouter from "./deriv";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/deriv", derivRouter);

export default router;
