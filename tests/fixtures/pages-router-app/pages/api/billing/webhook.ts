import type { NextApiRequest, NextApiResponse } from "next";
import { verifyEvent } from "@/lib/stripe";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.status(verifyEvent(req.body) ? 200 : 400).end();
}
