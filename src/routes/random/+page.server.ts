import type { Actions, PageServerLoad } from './$types';
import { auth } from '$lib/server/lucia';
import prisma from '$lib/server/prisma';
import type { Prisma } from '@prisma/client';
import { error, fail, redirect } from '@sveltejs/kit';

console.log(process.env.BASE_URL);

export const load: PageServerLoad = async ({ locals, parent, url }) => {
	const parentData = await parent();
	const session = await locals.auth.validate();
	//if (session) throw redirect(302, "/");

	async function getRandomsForUser() {
		return await prisma.random.findMany({
			where: {
				AND: [
					{
						account_id: session.user.account_id
					},
					{
						status: 'active'
					}
				]
			}
		});
	}

	let returnObj = {};

	type RandomsForUser = Prisma.PromiseReturnType<typeof getRandomsForUser>;
	let randomsForUser: RandomsForUser = [];
	let filteredMatchData: Match[] = [];
	let rawMatchData: Match[] = [];
	let flags: any = {
		mocked: false
	};
	let responseComplete: any = null;

	if (session && session.user) {
		randomsForUser = await getRandomsForUser();

		if (randomsForUser.length > 0) {
			const response = await fetch(`${url.origin}/api/updateMatchesForUser/${session.user.account_id}`, {
				method: 'GET'
			});

			let responseData = await response.json();

			if (responseData.mocked) flags.mocked = true;

			console.log([`[random+page.server.ts] found ${responseData.matchData.length} for user`]);

			responseData.matchData.forEach((element: Match) => {
				element.start_time = new Date(Number(element.start_time) * 1000);
			});

			rawMatchData = responseData.matchData;
			filteredMatchData = rawMatchData.filter(
				(match: Match) => match.start_time > randomsForUser[0].date && match.hero_id === randomsForUser[0].randomedHero
			);

			let completeResponse = await fetch(`${url.origin}/api/random/${session.user.account_id}/complete`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					completedRandom: randomsForUser[0],
					completedMatch: filteredMatchData[0],
					session: session
				})
			});

			let completeResponseData = await completeResponse.json();
			console.log(completeResponseData);
			responseComplete = completeResponseData;
		}
	}

	return {
		...parentData,
		randoms: randomsForUser,
		rawMatchData,
		randomAttempts: filteredMatchData,
		flags,
		responseComplete
	};
};
