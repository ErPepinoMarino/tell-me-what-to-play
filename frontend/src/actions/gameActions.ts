"use server";

import { redirect } from "next/navigation";

export async function searchGames(formData: FormData) {
  const query = formData.get("query");

  redirect(`/?q=${query}`);
}
