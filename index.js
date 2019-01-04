const axios = require('axios');
const { format, addHours, addMinutes, isAfter } = require('date-fns');
const { min, max, contains, first } = require('underscore');

const findEarlistOpenLatestClosing = dates => {
	// Turn all times into dates to find the earliest open and latest closing times
	const times = dates.reduce((accu, { timeslots }) => {
		if (timeslots) {
			// Timeslot format is 'hh:mm'
			return accu.concat(timeslots.map(timeslot => new Date(`January 1, 1999 ${timeslot.time}:00`)));
		}

		return accu;
	}, []);

	return {
		earliest: min(times),
		latest: max(times)
	};
};

// Formats each time slot object for UI rendering
const formatSlot = ({isAvail, time, date}) => {
	const dateToFormat = new Date(`January 1, 1999 ${time}:00`);

	return {
		amPM: format(dateToFormat, 'a'),
		time,
		civilianTime: format(dateToFormat, 'h:mm'),
		isAvail,
		date
	};
};

// Creates an array of every possible timeslot from the earliest open to latest closing times
const createSlotMaster = ({earliest, latest}, interval) => {
	const slotMaster = [];
	const slotMasterOffset = [];
	let tmpTime = new Date(earliest);

	// While the tmpTime does not occur after the latest available time include it in slotmaster
	while (!isAfter(tmpTime, latest)) {
		slotMaster.push(format(tmpTime, 'HH:mm'));
		// Add a half interval to account for SL dealers who have offset weekend hours. IE Open 7:00am M-F, 7:30 Sat
		slotMasterOffset.push(format(addMinutes(tmpTime, interval / 2), 'HH:mm'));
		tmpTime = addMinutes(tmpTime, interval);
	}

	return {
		slotMaster,
		slotMasterOffset
	};
};

// Sets each timeslot to availible/unavailable
const setAvailability = (slotMaster, slotMasterOffset, { timeslots, date }, deliveryDate) => { // eslint-disable-line
	return slotMaster.reduce((accu, slot, index) => { // eslint-disable-line
		// Check to make sure the timeslot is there, then also check to see if the date-time in
		// Question is after the original delivery date
		if (timeslots[index]) {
			const {offset} = timeslots[index];
			const ISODateOfTimeslot = addHours(new Date(`${date}T${slot}:00.000Z`), offset * -1);
			const isAvailMaster = contains(slotMaster, timeslots[index].time);
			const isAvailOffset = contains(slotMasterOffset, timeslots[index].time);
			const isAvail = isAvailMaster && isAfter(ISODateOfTimeslot, deliveryDate) || isAvailOffset;

			accu.push(formatSlot({
				isAvail,
				time: isAvail ? timeslots[index].time : slot,
				date
			}));

		} else {
			accu.push(formatSlot({
				isAvail: false,
				time: slot,
				date
			}));
		}

		return accu;

	}, []);
};

const setClosed = (slotMaster, d) => {
	return slotMaster.reduce((accu, slot) => {
		accu.push(formatSlot({
			isAvail: false,
			time: slot,
			isOffSet: false,
			date: d.date
		}));

		return accu;
	}, []);
};

// Creates dates with formatted timeslots for each available time
const createTimeslots = (dates, interval, deliveryDate) => {
	const { slotMaster, slotMasterOffset } = createSlotMaster(findEarlistOpenLatestClosing(dates), interval);

	return dates.reduce((accu, d) => {
		const timeslots = d.isClosed || d.timeslots === null
			? setClosed(slotMaster, d) : setAvailability(slotMaster, slotMasterOffset, d, deliveryDate);

		accu.push({
			timeslots,
			date: d.date
		});

		return accu;
	}, []);
};

const createTableCells = (dates) => {
	const slots = dates[0].timeslots;

	return slots.reduce((accu, slot, index) => {
		accu.push(dates.map(d => d.timeslots[index]));

		return accu;
	}, []);
};

// Returns the timezone offset for the dealership
const getOffset = (dates) => {
	const open = dates.filter( date => date.timeslots !== null && date.timeslots.length > 0 );

	return first(first(open).timeslots).offset;
};

/**
 * Gives a total qty of loose/stag tires
 * @param {Array} qtyArr - Array of qty
 * @return {number} The total qty.
 */
const totalQty = qtyArr => qtyArr.reduce((accu, qty) => qty + accu, 0);

const calendarBuilder = (options, cb) => {
	const { daysToReturn, transportationOption, startDate, deliveryDate, make, model, year } = options;

	axios.get('/service/timeslots', {
		params: {
			daysToReturn,
			transportationOption,
			startDate: format(startDate, 'YYYY-MM-DD'),
			year,
			make,
			model
		}
	})
		.then(({ data }) => {
			const { interval, provider, dates, transportationOptions } = data;
			const formattedDates = createTimeslots(dates, interval, deliveryDate);

			return cb({
				offset: getOffset(dates),
				provider,
				transportationOptions,
				dates: formattedDates,
				tableFormat: {
					body: createTableCells(formattedDates),
					headers: formattedDates.map(d => d.date)
				}
			});

		})
		.catch(err => {
			throw new Error(err);
		});
};

module.exports = {
	calendarBuilder,
	totalQty,
	createTimeslots,
	createSlotMaster,
	formatSlot,
	findEarlistOpenLatestClosing,
	setAvailability,
	setClosed
};
