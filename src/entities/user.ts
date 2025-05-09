import {Address} from '@graphprotocol/graph-ts'
import {User} from '../../generated/schema'
import {BIG_INT_ONE} from '../constants'
import {loadPoolManager} from './poolManager'

export function loadUser(address: Address): User {
  const poolManager = loadPoolManager()
  let user = User.load(address.toHexString())

  if (!user) {
    user = new User(address.toHexString())
    user.lbTokenApprovals = []
    poolManager.userCount = poolManager.userCount.plus(BIG_INT_ONE)

    user.save()
    poolManager.save()
  }

  return user as User
}
