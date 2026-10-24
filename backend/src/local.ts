import cors from "cors";
import express from "express";
import { handleRequest } from "./http/router";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use(async (req, res) => {
  const response = await handleRequest({
    method: req.method,
    path: req.path,
    body: req.body,
  });
  res.status(response.statusCode).set(response.headers).json(response.body);
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`Lifeline OS API (local) http://localhost:${port}`);
  console.log(`GET  /state   POST /simulate   POST /requests   GET /contract`);
});
