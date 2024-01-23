//lucia
import { auth } from '$lib/server/lucia';

//svelte
import { fail, redirect, json } from '@sveltejs/kit';
import { setContext, getContext, onMount } from 'svelte';
import type { Actions, PageServerLoad } from './$types';

//prisma
import type { TurbotownMetric, TurbotownItem, User } from '@prisma/client';
import type { Item } from '@prisma/client';
import prisma from '$lib/server/prisma';
import type { Hero } from '@prisma/client';

//dayjs
import dayjs from 'dayjs';

//stores
import { townStore } from '$lib/stores/townStore';

//constants
import { constant_questGold, constant_questXP } from '$lib/constants/turbotown';
//import { createDotaUser } from '../api/helpers';

export const actions: Actions = {
	useObserver: async ({ request, locals, fetch }) => {
		console.log('received useObserver post in turbotown page server');
		const session = await locals.auth.validate();
		if (!session) return fail(400, { message: 'Not logged in, cannot use item' });
		const formData = await request.formData();

		let turbotownID = parseInt(formData.get('turbotownID')?.toString() || '-1');
		let questStoreSlot = parseInt(formData.get('questStoreSlot')?.toString() || '');
		let questStore = JSON.parse(formData.get('questStore')?.toString() || '');
		let seasonID = JSON.parse(formData.get('seasonID')?.toString() || '');
		//console.log('turbotownID: ', (turbotownID))
		//console.log('random hero select:', hero);

		console.log('[observer page.server.ts] user trying to use item', session.user.account_id);
		try {
			let tx_result = await prisma.$transaction(
				async (tx) => {
					let tx_startTime = dayjs();
					// 1. Verify that the user has at least one of the item in inventory
					// look for itemID 0 (observer) for now - this will need to change when there are more items
					let itemCheck = await tx.turbotownItem.findFirstOrThrow({
						where: {
							AND: [{ itemID: 0 }, { turbotownID }]
						}
					});

					// 2. Decrement item from the user
					if (itemCheck) {
						console.log('[observer page.server.ts] item found');
						const sender = await tx.turbotownItem.delete({
							where: {
								id: itemCheck.id
							}
						});

						console.log('itemCheck for delete: ', sender);

						if (!sender) {
							throw new Error(`${session.user.account_id} failed to delete item!`);
						}

						// 3. Enter the selected random hero into the quest slot
						let questData = {
							...questStore,
							availableHeroes: questStore.availableHeroes.map((hero: Hero) => hero.id),
							bannedHeroes: questStore.bannedHeroes.map((hero: Hero) => hero.id),
							randomedHero: questStore.randomedHero.id,
							questSlot: questStoreSlot,
							session
						};

						//fairly certain the calls to prisma.xx inside transaction is locking the DB
						/*
						let response = await fetch(`/api/random/${session.user.account_id}/create`, {
							method: 'POST',
							headers: {
								'Content-Type': 'application/json'
							},
							body: JSON.stringify(questData)
						});

						let randomCreateResponseData = await response.json();
						*/

						//new method
						let randomCreateResponse = await tx.random.create({
							data: {
								account_id: session.user.account_id,
								active: true,
								status: 'active',
								date: new Date(),
								availableHeroes: questData.availableHeroes.toString(),
								bannedHeroes: questData.bannedHeroes.toString(),
								selectedRoles: questData.selectedRoles.toString(),
								expectedGold: questData.expectedGold,
								modifierAmount: questData.modifierAmount,
								modifierTotal: questData.modifierTotal,
								randomedHero: questData.randomedHero,
								seasons: {
									connect: { id: seasonID }
								},
								quests: {
									create: {
										turbotownID,
										questSlot: questData.questSlot,
										type: 'random',
										active: true,
										status: 'active',
										xp: constant_questXP,
										gold: constant_questGold,
										createdDate: new Date()
									}
								}
							}
						});

						console.log('[observer page.server.ts] random created', randomCreateResponse);

						let statusActive = await tx.turbotownStatus.findFirst({
							where: {
								isActive: true
							}
						});

						//3. create turbo town action
						if (statusActive && randomCreateResponse) {
							console.log('[observer page.server.ts] found observer status', statusActive);
							const itemUseResponse = await tx.turbotownAction.create({
								data: {
									action: 'observer',
									turbotownDestinationID: turbotownID,
									appliedDate: new Date(),
									endDate: new Date()
								}
							});

							console.log('[observer page.server.ts] item use response: ', itemUseResponse);

							// 4. add resolvedDate to TurboTownStatus
							let statusUpdateResult = await tx.turbotownStatus.update({
								where: {
									id: statusActive.id
								},
								data: {
									isActive: false,
									resolvedDate: new Date()
								}
							});

							let tx_endTime = dayjs();
							let executionTime = tx_endTime.diff(tx_startTime, 'millisecond');

							return { itemUseResponse, executionTime };
						} else {
							throw new Error(`${session.user.account_id} could not find active observer item or create random`);
						}
					} else {
						//add else-ifs for other items as they are developed
					}
				},
				{
					maxWait: 9500, // default: 2000
					timeout: 9500 // default: 5000
				}
			);

			if (tx_result) {
				console.log('returning');
				return { action: 'use item', result: tx_result, success: true };
			} else console.error('no return from use item');
		} catch (err) {
			console.error(err);
			return fail(400, { message: 'Could not delete item' });
		}
	},
	useLinkens: async ({ request, locals, fetch }) => {
		console.log('received useLinkens post in turbotown page server');
		const session = await locals.auth.validate();
		if (!session) return fail(400, { message: 'Not logged in, cannot use item' });
		const formData = await request.formData();

		let turbotownID = parseInt(formData.get('turbotownID')?.toString() || '-1');

		try {
			let tx_result = await prisma.$transaction(async (tx) => {
				// 1. Verify that the user has at least one of the item in inventory
				// look for itemID 2 (linkens sphere)
				let itemCheck = await tx.turbotownItem.findFirstOrThrow({
					where: {
						itemID: 2
					}
				});

				// 2. Decrement item from the user
				if (itemCheck) {
					const sender = await tx.turbotownItem.delete({
						where: {
							id: itemCheck.id
						}
					});

					if (!sender) {
						throw new Error(`${session.user.account_id} failed to delete item!`);
					}

					// 3. Check if the user already has a Linken's Sphere buff applied
					let statusActive = await tx.turbotownStatus.findFirst({
						where: {
							AND: [
								{
									isActive: true,
									name: "linkens"
								}
							]
						},
					})

					if (statusActive) {
						throw new Error(`${session.user.account_id} already has a Linken's Sphere buff applied!`);
					}
				}

				const itemUseResponse = await tx.turbotownAction.create({
					data: {
						action: 'observer',
						turbotownDestinationID: turbotownID,
						appliedDate: new Date(),
						endDate: new Date()
					}
				});
				console.log(itemUseResponse);

				return itemUseResponse;
			});

			if (tx_result) {
				console.log('returning');
				return { action: 'use item', result: tx_result, success: true };
			} else console.error('no return from use item');
		} catch (err) {
			console.error(err);
			return fail(400, { message: 'Could not delete item' });
		}
	},
	addFakeMatch: async ({ request, locals }) => {
		console.log('received createFakeMatch post in turbotown page server');
		const session = await locals.auth.validate();
		if (!session) return fail(400, { message: 'Not logged in, cannot use item' });
		const formData = await request.formData();
		let account_id: number = parseInt(formData.get('account_id')?.toString() || '-1');
		let heroID: number = parseInt(formData.get('heroID')?.toString() || '-1');
		let win: string = formData.get('win')?.toString() || 'true';
		let timestamp: number = parseInt(formData.get('matchTS')?.toString() || '0');
		//let activeOptionID = parseInt(formData.get('activeOptionID')?.toString() || '-1')
		//console.log('active option ID:', activeOptionID);
		console.log(account_id, heroID, win, timestamp);

		if (account_id === -1) return fail(400, { account_id, missing: true });
		if (heroID === -1) return fail(400, { heroID, missing: true });
		if (timestamp === 0) return fail(400, { timestamp, missing: true });

		let winVal: boolean = false;
		if (win === '1') winVal = true;

		console.log('[admin] - user trying to add fake match', session.user.account_id);
		let fakeMatch = {
			match_id: parseInt('999999' + Math.floor(Math.random() * 9999)),
			account_id: account_id,
			player_slot: 2,
			radiant_win: winVal,
			game_mode: 23,
			hero_id: heroID,
			start_time: timestamp,
			duration: 1323,
			lobby_type: 0,
			version: null,
			kills: 10,
			deaths: 2,
			assists: 13,
			skill: null,
			average_rank: 35,
			leaver_status: 0,
			party_size: null
		};

		const matchInsertResult = await prisma.match.upsert({
			where: {
				matchPlusAccount: { match_id: fakeMatch.match_id, account_id: fakeMatch.account_id }
			},
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-ignore: Unreachable code error
			update: { ...fakeMatch },
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-ignore: Unreachable code error
			create: { ...fakeMatch }
		});

		if (matchInsertResult) return { success: true, matchInsertResult };
	}
};
