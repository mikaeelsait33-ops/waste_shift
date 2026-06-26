import { useState } from 'react';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function DateNavigator({ selectedDate, onDateChange, viewMode, onViewModeChange }) {
  const [showCalendar, setShowCalendar] = useState(false);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const formatDisplayDate = (date) => {
    const d = new Date(date);
    const day = d.getDate();
    const month = MONTHS[d.getMonth()];
    const year = d.getFullYear();
    const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });

    const isToday = d.getTime() === today.getTime();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.getTime() === yesterday.getTime();

    if (isToday) return `Today - ${weekday}, ${day} ${month} ${year}`;
    if (isYesterday) return `Yesterday - ${weekday}, ${day} ${month} ${year}`;
    return `${weekday}, ${day} ${month} ${year}`;
  };

  const formatDisplayMonth = (date) => {
    const d = new Date(date);
    const month = MONTHS[d.getMonth()];
    const year = d.getFullYear();
    const isCurrentMonth = d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();

    if (isCurrentMonth) return `This Month - ${month} ${year}`;
    return `${month} ${year}`;
  };

  const navigateDay = (direction) => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + direction);
    if (newDate <= today) onDateChange(newDate);
  };

  const navigateMonth = (direction) => {
    const newDate = new Date(selectedDate);
    newDate.setMonth(newDate.getMonth() + direction);
    const futureCheck = new Date(newDate.getFullYear(), newDate.getMonth(), 1);
    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    if (futureCheck <= currentMonthStart || direction < 0) onDateChange(newDate);
  };

  const goToToday = () => {
    onDateChange(new Date(today));
  };

  const handleCalendarChange = (e) => {
    const [y, m, d] = e.target.value.split('-');
    const newDate = new Date(Number(y), Number(m) - 1, Number(d));
    onDateChange(newDate);
    setShowCalendar(false);
  };

  const getCalendarValue = () => {
    const d = new Date(selectedDate);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getTodayYMD = () => {
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const isAtToday = () => {
    const d = new Date(selectedDate);
    d.setHours(0, 0, 0, 0);
    if (viewMode === 'day') return d.getTime() === today.getTime();
    if (viewMode === 'month') return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
    return true;
  };

  const canGoForward = !isAtToday();

  return (
    <div className="date-navigator">
      <div className="segmented-control" aria-label="Waste log date view" style={{ marginBottom: viewMode === 'all' ? 0 : '12px' }}>
        <button type="button" onClick={() => onViewModeChange('day')} className={`segment-button${viewMode === 'day' ? ' is-active' : ''}`}>
          Day
        </button>
        <button type="button" onClick={() => onViewModeChange('month')} className={`segment-button${viewMode === 'month' ? ' is-active' : ''}`}>
          Month
        </button>
        <button type="button" onClick={() => onViewModeChange('all')} className={`segment-button${viewMode === 'all' ? ' is-active' : ''}`}>
          All time
        </button>
      </div>

      {viewMode !== 'all' && (
        <div className="date-nav-row">
          <button
            type="button"
            onClick={() => (viewMode === 'day' ? navigateDay(-1) : navigateMonth(-1))}
            className="icon-button"
            title={viewMode === 'day' ? 'Previous day' : 'Previous month'}
          >
            {'<'}
          </button>

          <div className="date-display">
            <span className="date-title">
              {viewMode === 'day' ? formatDisplayDate(selectedDate) : formatDisplayMonth(selectedDate)}
            </span>

            <div className="date-actions">
              {!isAtToday() && (
                <button type="button" onClick={goToToday} className="ghost-button is-warning">
                  Today
                </button>
              )}

              {viewMode === 'day' && (
                <button type="button" onClick={() => setShowCalendar(!showCalendar)} className="ghost-button">
                  Pick date
                </button>
              )}
            </div>

            {showCalendar && viewMode === 'day' && (
              <input
                type="date"
                value={getCalendarValue()}
                max={getTodayYMD()}
                onChange={handleCalendarChange}
                className="input"
                style={{ marginTop: '10px', maxWidth: '180px' }}
              />
            )}
          </div>

          <button
            type="button"
            onClick={() => canGoForward && (viewMode === 'day' ? navigateDay(1) : navigateMonth(1))}
            className="icon-button"
            title={viewMode === 'day' ? 'Next day' : 'Next month'}
            disabled={!canGoForward}
          >
            {'>'}
          </button>
        </div>
      )}
    </div>
  );
}

export default DateNavigator;
