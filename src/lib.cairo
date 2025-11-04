#[starknet::contract]
mod performanceTest {
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use core::array::ArrayTrait;

    #[storage]
    struct Storage {
        balances: Map<ContractAddress, u256>,
        addresses: Map<u32, ContractAddress>,  // Indexed list of unique addresses
        address_count: u32,
        batch_infos: Map<felt252, BatchInfo>,
        batch_ids: Map<u32, felt252>,  // Indexed list of batch_ids
        batch_count: u32,
        admin_address: ContractAddress,  // Admin address set in constructor
    }

    #[derive(Copy, Drop, Serde, starknet::Store)]
    struct BatchInfo {
        batch_id: felt252,
        batch_type: felt252,
        num_items: u32,
        cost: u128,
        elapsed_seconds: u32,
    }

    #[constructor]
    fn constructor(ref self: ContractState, admin_address: ContractAddress) {
        self.admin_address.write(admin_address);
    }

    #[external(v0)]
    fn update_balance(ref self: ContractState, new_balance: u256) {
        let caller = get_caller_address();
        let old_balance = self.balances.read(caller);
        if old_balance == 0 {
            // Add to tracked addresses if new
            let count = self.address_count.read();
            self.addresses.write(count, caller);
            self.address_count.write(count + 1);
        }
        self.balances.write(caller, new_balance);
    }

    #[external(v0)]
    fn get_balance(self: @ContractState, address: ContractAddress) -> u256 {
        self.balances.read(address)
    }

    #[external(v0)]
    fn get_all_balances(self: @ContractState) -> Array<(ContractAddress, u256)> {
        let mut result: Array<(ContractAddress, u256)> = array![];
        let count = self.address_count.read();
        let mut i: u32 = 0;
        loop {
            if i >= count {
                break;
            }
            let addr = self.addresses.read(i);
            let bal = self.balances.read(addr);
            result.append((addr, bal));
            i += 1;
        };
        result
    }

    #[external(v0)]
    fn set_batch_info(ref self: ContractState, info: BatchInfo) {
        // Check if batch_id already exists (to avoid duplicates in list)
        let existing = self.batch_infos.read(info.batch_id);
        if existing.batch_id == 0 {  // Assuming 0 means not set
            let count = self.batch_count.read();
            self.batch_ids.write(count, info.batch_id);
            self.batch_count.write(count + 1);
        }
        self.batch_infos.write(info.batch_id, info);
    }

    #[external(v0)]
    fn get_batch_info(self: @ContractState, batch_id: felt252) -> BatchInfo {
        self.batch_infos.read(batch_id)
    }

    #[external(v0)]
    fn get_all_batch_infos(self: @ContractState) -> Array<BatchInfo> {
        let mut result: Array<BatchInfo> = array![];
        let count = self.batch_count.read();
        let mut i: u32 = 0;
        loop {
            if i >= count {
                break;
            }
            let id = self.batch_ids.read(i);
            let info = self.batch_infos.read(id);
            result.append(info);
            i += 1;
        };
        result
    }

    #[external(v0)]
    fn update_and_get(ref self: ContractState, new_balance: u256) -> u256 {
        update_balance(ref self, new_balance);
        get_balance(@self, get_caller_address())
    }

    // New: Batch update function (admin only)
    #[external(v0)]
    fn batch_update(ref self: ContractState, updates: Array<(ContractAddress, u256)>) {
        let caller = get_caller_address();
        let admin = self.admin_address.read();
        assert(caller == admin, 'Only admin can batch update');
        let len = updates.len();
        let mut i: u32 = 0;
        loop {
            if i >= len {
                break;
            }
            let (addr, bal) = *updates.at(i);
            let old_balance = self.balances.read(addr);
            if old_balance == 0 {
                let count = self.address_count.read();
                self.addresses.write(count, addr);
                self.address_count.write(count + 1);
            }
            self.balances.write(addr, bal);
            i += 1;
        };
    }
}