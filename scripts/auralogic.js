//Synopsis: Copies aura buffs between actors in the Pathfinder 1.E system in FoundryVTT
//
//Create by:   Jeremy/Cactuar       
//Date:         4/19/23
//
//Details:
// If an actor has a buff in their buffs tab that ends with (Received)
// It will clone it to all allies within the radius of the aura.
// Allied gets a 0 radius copy of the aura, which can't be copied to others. (radius > 0 is the trigger)
// The radius needs to be set as a dictionary flag in the buff itself, as follows:        
//        name       value
//       radius        xx
// (You can find the dictionary flags when you edit the buff in the buffs tab of a character sheet)
// Adding a Boolean Flag of "shareInactive" causes auras to share even if toggled off (for buggs that don't affect self)
// It will basically add these steps into the game right after sightRefresh.
// Tokens refresh sight at the end of movement by default, so this reduces how often it fires. There's likely a better hook.
// Unconcious tokens do not give buffs
// When a token faints all buffs it offers are removed.

export class AuraLogic{
    static GetAuras(token, getParentAuras){
        //will filter for parent/child auras automatically using the booleon getParentAuras flag.;
        let auraActor = token.getActor();
        let auras = [];
        if(getParentAuras == true){
            auras = (auraActor.items?.filter(o => o.system?.flags?.dictionary?.radius > 0));
            //Auras with a radius greater than 0 share.
        }else{
            auras = (auraActor.items?.filter(o => o.system?.flags?.dictionary?.radius === 0)); 
            //likewise auras with a radius of 0 do not share.
        }
        return auras;
    }

    static async AddAuras(auras, childToken){   ///auras is just an object passed in where we're looking for the aura name
        console.log("AddAura");
        let aurasToAdd = [];
        let childActor = childToken.getActor();
        Promise.all(auras.map(async (aura) => {
            let foundAura = childActor.items?.getName(aura.name); ///<-- looking for the name there
            if(!foundAura){
                aurasToAdd.push(aura);
            }else                       
            {
                foundAura.setActive(true);                         /// But only the last aura to "setActive" gets displayed on the token.
            }
        }));
        if(aurasToAdd?.length > 0){
            childToken.actor.createEmbeddedDocuments('Item', aurasToAdd);   ///This just creates a new aura if the actor doesn't have one to toggle on/off.
        }
        return;
    }

    static async removeAuras(auras, childToken){
        let childActor = childToken.getActor();
        let auraIDsToDelete = [];
        //we're making an array containing aura objects, but only if the name matches an existing aura.
        Promise.all(auras.map(async (aura) => {
            let foundAura = childActor.items.getName(aura.name) ?? childActor.getEmbeddedDocument('Item', aura._id);
            if(foundAura){
                auraIDsToDelete.push(foundAura._id);
            }
        }));
        if(auraIDsToDelete?.length > 0){
            childToken.actor.deleteEmbeddedDocuments('Item', auraIDsToDelete);
            //remove the aura documents from the actor
        }
        return;
    }

    static async deactivateAuras(auras, childToken){
        let childActor = childToken.getActor();
        Promise.all(auras.map(async (aura) => {
            let foundAura = childActor.items?.getName(aura.name);
            if(foundAura){
                foundAura.setActive(false);
            }
        }));
        return;
    }
    
    static async clearSingleAuraSet(parentToken, parentAuras, childToken){
        let aurasToRemove = [];
        if(parentAuras?.length > 0 ){
            Promise.all(parentAuras.map(async (parentAura) => {
                //Create Aura Copy//
                let parentActor = parentToken.getActor();
                let newAura = parentActor.getEmbeddedDocument('Item', parentAura._id).toObject();
                newAura.name = parentAura.name + " (" + parentToken.name + ")";
                newAura.system.identifiedName = parentAura.name + " (" + parentToken.name + ")";
                newAura.system.flags.dictionary.radius = 0;
                aurasToRemove.push(newAura);
            }));
        }
        if(aurasToRemove.length > 0){
            this.deactivateAuras(aurasToRemove, childToken);  //change deactivate
        }
        return;
    }

    static async clearAllChildAuras(token){
        let auras = this.GetAuras(token, false);
        if(auras){
            await this.removeAuras(auras, token);                                               
        }
    }

    static async ApplyActorAuras(parentToken, parentAuras, childToken){
        let distance = canvas.grid.measureDistance(childToken, parentToken); 
        let aurasToAdd = [];
        let aurasToRemove = [];
        //Grabs the parent auras of the token that just moved
        if(parentAuras?.length > 0 && distance != undefined){
            Promise.all(parentAuras.map(async (parentAura) => {
                //Create Aura Copy//
                let parentActor = parentToken.getActor();
                let newAura = parentActor.getEmbeddedDocument('Item', parentAura._id).toObject();
                newAura.name = parentAura.name + " (" + parentToken.name + ")";
                newAura.system.identifiedName = parentAura.name + " (" + parentToken.name + ")";
                newAura.system.flags.dictionary.radius = 0;
                newAura.system.active = true;
                //we grabbed the aura, added the parents (name) to it, set the radius to 0 (necessary), and told the system that it will be active when applied.
                let radius = parentAura.getItemDictionaryFlag('radius');
                let inRange = (distance <= radius);
                let shareIfInactive = this.GetInactiveShareFlag(parentAura);
                let canShareAura = this.CanShareAura(parentToken, childToken, parentAura) ?? true;
                let validateAura = ((parentAura.system.active || shareIfInactive) && inRange && !this.IsUnconscious(parentActor) && canShareAura);
                //if the buff has a radius but the distance is greater.
                if(validateAura){
                    aurasToAdd.push(newAura);
                }else{
                    aurasToRemove.push(newAura);
                }
            }));
        }
        if(aurasToAdd.length > 0){
            this.AddAuras(aurasToAdd, childToken);
        }
        if(aurasToRemove.length > 0){
            this.deactivateAuras(aurasToRemove, childToken);
        }
        return;
    }

    static async refreshAuras(parentToken, childTokens, deleteOnly){
        let giveAuras = await this.GetAuras(parentToken, true);
        Promise.all(childTokens.map(async (childToken) => {
            if(childToken?.id != parentToken?.id){
                let receiveAuras = this.GetAuras(childToken, true);
                if(giveAuras?.length > 0){
                    if(deleteOnly){
                        await this.clearSingleAuraSet(parentToken, giveAuras, childToken);
                    }else{
                        console.log(1);
                        this.ApplyActorAuras(parentToken, giveAuras, childToken);
                    }
                }
                if(receiveAuras?.length > 0){
                    this.ApplyActorAuras(childToken, receiveAuras, parentToken);
                }
            }
        }))
/*
        childTokens.forEach( async childToken => {
            if(childToken?.id != parentToken?.id){
                let receiveAuras = this.GetAuras(childToken, true);
                if(giveAuras?.length > 0){
                    if(deleteOnly){
                        await this.clearSingleAuraSet(parentToken, giveAuras, childToken);
                    }else{
                        console.log(1);
                        await this.ApplyActorAuras(parentToken, giveAuras, childToken);
                    }
                }
                if(receiveAuras?.length > 0){
                    await this.ApplyActorAuras(childToken, receiveAuras, parentToken);
                }
            }
        });
        */

        return;
    }

    static CanShareAura(parentToken, childToken, aura){
        //verifies that the aura is set to apply to allies, or else if enemies verifies that target is an enemy.
        let parentTokenDisposition = parentToken.disposition;
        let childTokenDisposition = childToken.disposition;
        let hostileAura = aura.hasItemBooleanFlag('shareEnemies');
        if(hostileAura){
            if(parentTokenDisposition == (childTokenDisposition * -1)){
                return true;
            }
        }
        else{
            if(parentTokenDisposition == childTokenDisposition){
                return true;
            }
        }
        return false;
    }

    static GetInactiveShareFlag(aura){
        let shareAura = false;
        if(aura.hasItemBooleanFlag('shareInactive')){
            shareAura = true;
        }
        return shareAura;
    }


    static IsUnconscious(actor){
        let unconsciousAuras = game.settings.get('aurashare', 'UnconsciousAuras');
        if (unconsciousAuras){
            return false;
        }
        let health = actor.system.attributes.hp.value;
        if(health < 1 && !this.dieHardCheck(actor)){
            return true;
        }
        return false;
    }

    static dieHardCheck(actor){
        let diehardEnabled = game.settings.get('aurashare', 'Diehard');
        if(actor.items.getName('Diehard') && diehardEnabled){
            return true;
        }
        return false;
    }
}