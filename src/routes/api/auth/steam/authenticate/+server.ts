import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { prisma } from '$lib/server/prisma'
//const SteamAuth = require("node-steam-openid");
import { auth } from '$lib/server/lucia'
import steam from '../steam';

export const GET: RequestHandler = async ({ request, locals, params, url }) => {
    console.log('received GET to authenticate')

    const steamUser = await steam.authenticate(request);

    let dbUser = await auth.getUser(steamUser.steamid);
    //let dbUser = null

    if(!dbUser){
        dbUser = await auth.createUser({
            userId: steamUser.steamid,
            key: {
                providerId: 'steam',
                providerUserId: steamUser.steamid,
                password: null
            },
            attributes: {
                name: steamUser.name,
                username: steamUser.username,
                steam_id: steamUser.steamid,
                profile_url: steamUser.profile,
                avatar_url: steamUser.avatar.small            
            }
        })
    }

    if (!locals.auth.validate()) {
        const session = await auth.createSession({
            userId: dbUser.userId,
            attributes: {}
        });
        locals.auth.setSession(session);
    } else {
        const key = await auth.useKey('steam', steamUser.steamid, null)
		const session = await auth.createSession({userId: key.userId, attributes: {}})
		locals.auth.setSession(session)
    }

    // const session = await auth.createSession({
    //     userId: dbUser.userId,
    //     attributes: {}
    // });

    // locals.auth.setSession(session)

    //...do something with the data
    throw redirect(302, '/')
    //return new Response(JSON.stringify({ "user": user }))
};