//
// app/src/msw/handlers.server.ts
//

import { http } from "msw";

export const handlers = [
  http.get("/api/randomNumber", ({ request }) => {
   console.log(request)
  })
];